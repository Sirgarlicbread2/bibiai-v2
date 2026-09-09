import { Client, Events, GatewayIntentBits, Options, Partials, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, type GuildMember, type Message, type ChatInputCommandInteraction, type Interaction, type Attachment, type TextBasedChannel } from 'discord.js';
import { randomUUID } from 'node:crypto';
import type { Configuration } from './config.js';
import type { Storage } from './storage.js';
import type { Memory } from './memory.js';
import type { AI, Actor, Media, Reply } from './ai.js';
import { Minecraft, commandPolicy } from './minecraft.js';
import { Privacy } from './privacy.js';
import { Roles } from './roles.js';
import { Moderation } from './moderation.js';
import { Voice } from './voice.js';
import type { Appeals } from './appeals.js';
import { fetchBounded, cleanError } from './net.js';
import { commands } from './commands.js';

export class Discord {
  client:Client|undefined;
  status='Disabled';
  readonly privacy:Privacy;
  readonly roles:Roles;
  readonly moderation:Moderation;
  readonly voice:Voice;
  appeals:Appeals|undefined;
  private processing=0;
  private ready=false;
  private seen=new Map<string,number>();
  private cooldown=new Map<string,number>();
  private pending=new Map<string,{owner:string;subjects:string[];commands:string[];at:number;channel:string}>();
  private lastChime=0;
  private lastRevive=0;
  private nextSong=Date.now()+1800000;
  constructor(readonly cfg:Configuration,readonly disk:Storage,readonly memory:Memory,readonly ai:AI,readonly mc:Minecraft){
    this.privacy=new Privacy(cfg,disk);this.roles=new Roles(cfg);this.moderation=new Moderation(cfg,disk);this.voice=new Voice(cfg);
  }
  async start(){
    if(this.client)return;
    const c=this.cfg.value.discord;
    if(!c.enabled){this.status='Disabled';return;}
    if(!this.disk.ready)throw new Error('Connect NAS storage before starting Discord.');
    if(!this.cfg.secrets.discord_token||!c.guildId||!c.privacyRole||!c.channels.length)throw new Error('Configure the Discord token, server, privacy role, and channels first.');
    this.status='Connecting';this.ready=false;
    const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.MessageContent],
      partials:[Partials.GuildMember],makeCache:Options.cacheWithLimits({...Options.DefaultMakeCacheSettings,MessageManager:0,UserManager:100,GuildMemberManager:{maxSize:100,keepOverLimit:m=>m.id===m.client.user.id}}),allowedMentions:{parse:[],repliedUser:false}});
    this.client=client;
    client.on('error',()=>{this.status='Discord connection error';});
    client.on(Events.GuildMemberUpdate,(_old,member)=>{void(async()=>{
      if(this.client!==client||member.guild.id!==c.guildId)return;
      if(member.roles.cache.has(this.cfg.value.discord.privacyRole))await this.forget(member.id);
    })().catch(()=>{this.ready=false;this.status='Privacy reconciliation failed; processing paused';});});
    client.on(Events.GuildMemberRemove,member=>{if(member.guild.id===c.guildId)void this.forget(member.id).catch(()=>{this.ready=false;});});
    client.on(Events.GuildMemberAdd,member=>{void(async()=>{if(!this.ready)return;const accepted=await this.privacy.member(member.guild,member.id);if(accepted)await this.roles.auto(accepted);})().catch(()=>{});});
    client.on(Events.MessageCreate,message=>{void this.onMessage(message);});
    client.on(Events.InteractionCreate,i=>{void this.onInteraction(i);});
    client.once(Events.ClientReady,()=>{void(async()=>{
      if(this.client!==client)return;
      const guild=await client.guilds.fetch(c.guildId);
      const privacyRole=await guild.roles.fetch(c.privacyRole);if(!privacyRole||privacyRole.managed||privacyRole.id===guild.id||privacyRole.permissions.bitfield!==0n)throw new Error('Privacy role must be a normal role with no permissions.');
      this.status='Checking privacy preferences';await this.privacy.validateStored(guild);
      if(this.client!==client)return;
      await guild.commands.set(commands);if(this.client!==client)return;this.ready=true;this.status='Online';
    })().catch(e=>{if(this.client===client){this.status=cleanError(e);this.ready=false;}});});
    try{await client.login(this.cfg.secrets.discord_token);}catch{this.stop();this.status='Discord login failed';throw new Error(this.status);}
  }
  stop(){this.ready=false;this.voice.leave();this.client?.destroy();this.client=undefined;this.pending.clear();this.seen.clear();this.cooldown.clear();this.status='Stopped';}
  async forget(id:string){
    this.voice.leave();this.moderation.forget(id);this.cooldown.delete(id);this.seen.clear();
    for(const[k,p]of this.pending)if(p.subjects.includes(id))this.pending.delete(k);
    let messages:any[]=[];
    await this.disk.forget(id,row=>{if(row.kind==='outgoing')messages.push(row);});this.client?.users.cache.delete(id);
    // Best effort removal of BibiAI's own recent Discord outputs; local erasure is independent.
    for(const r of messages)try{const ch=await this.client?.channels.fetch(r.data.channel);if(ch?.isTextBased()&&'messages'in ch)await ch.messages.delete(r.data.message);}catch{}
  }
  private actor(member:GuildMember,channel:string,subjects:string[]=[]):Actor{
    const operator=this.roles.operator(member);
    return{id:member.id,source:'discord',channel,subjects,operator,authorize:async(ids?:string[])=>{
      if(!this.ready||!this.disk.ready||member.guild.client!==this.client)return false;
      for(const id of new Set([member.id,...subjects,...(ids||[])]))if(/^\d{16,22}$/.test(id)){
        const current=await this.privacy.member(member.guild,id);if(!current||(id===member.id&&operator&&!this.roles.operator(current)))return false;
      }
      return true;
    }};
  }
  private async subjectsAllowed(subjects:string[]){
    if(!this.ready||!this.client)return false;
    const guild=this.client.guilds.cache.get(this.cfg.value.discord.guildId);if(!guild)return false;
    for(const id of subjects)if(/^\d{16,22}$/.test(id)&&!await this.privacy.member(guild,id))return false;
    return this.disk.allowed(subjects);
  }
  async notify(text:string,subjects:string[]=[],channelId=this.cfg.value.discord.reportChannel){
    if(!this.client||!channelId||!await this.subjectsAllowed(subjects))return false;
    const ch=await this.client.channels.fetch(channelId);if(!ch?.isTextBased()||!('send'in ch))return false;
    const m=await ch.send({content:text.slice(0,1900),allowedMentions:{parse:[]}});
    if(this.disk.ready&&subjects.length)await this.disk.put('outgoing',{channel:m.channelId,message:m.id},subjects);
    return true;
  }
  async untimeout(id:string){
    const guild=this.client?.guilds.cache.get(this.cfg.value.discord.guildId);
    const member=guild?await this.privacy.member(guild,id):null;
    if(!member||!member.moderatable)throw new Error('Member is unavailable or cannot be moderated.');
    await member.timeout(null,'Appeal granted');
  }
  private consume(id:string,seconds=8){const previous=this.cooldown.get(id)||0;if(Date.now()-previous<seconds*1000)return false;this.cooldown.set(id,Date.now());if(this.cooldown.size>500)this.cooldown.delete(this.cooldown.keys().next().value!);return true;}
  joinText(){const j=this.cfg.value.join;return[`**${j.packName}**`,j.address?`Server: \`${j.address}\``:'Server address has not been configured.',j.version?`Minecraft: ${j.version}`:'',j.modrinth?`Modrinth pack: ${j.modrinth}\nModrinth App → Create instance → From file → select the downloaded .mrpack → install → launch.`:'',j.curseforge?`CurseForge pack: ${j.curseforge}\nCurseForge → Minecraft → Create Custom Profile → Import → select the downloaded ZIP → install → launch.`:'',j.notes,j.helpChannel?`Need help? <#${j.helpChannel}>`:''].filter(Boolean).join('\n\n');}
  private vacationText(){const v=this.cfg.value.vacation;return`Vacation mode: ${v.enabled?'on':'off'}. ${v.note}\n${v.returnDate?`Expected return: ${v.returnDate}\n`:''}Rules: ${v.rules}\nUse /join for setup help.`;}
  private async media(attachments:Attachment[]):Promise<Media[]>{
    const result:Media[]=[];let total=0;
    for(const a of attachments.slice(0,3)){
      const mime=a.contentType?.split(';')[0]||'';
      if(!/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime))$/.test(mime))continue;
      if(a.size>3*1024*1024||total+a.size>6*1024*1024)throw new Error('Media limit: 3 MiB per file, 6 MiB per request.');
      const url=new URL(a.url);if(url.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname))throw new Error('Invalid attachment host.');
      const bytes=await fetchBounded(a.url,{},3*1024*1024);total+=bytes.length;result.push({mimeType:mime,data:bytes.toString('base64')});
    }return result;
  }
  private buttons(reply:Reply,owner:string,channel:string){
    if(!reply.commands.length)return[];
    if(this.pending.size>=50)this.pending.delete(this.pending.keys().next().value!);
    const id=randomUUID();this.pending.set(id,{owner,subjects:reply.subjects,commands:reply.commands.map(c=>c.command),at:Date.now(),channel});
    return[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`mc:${id}`).setLabel('Confirm listed commands').setStyle(ButtonStyle.Danger))];
  }
  private formatReply(reply:Reply){return reply.text+(reply.commands.length?'\n\n**Awaiting operator confirmation:**\n'+reply.commands.map(c=>`• \`${c.command}\` — ${c.reason}`).join('\n'):'');}
  private async sendReply(target:Message|ChatInputCommandInteraction,reply:Reply){
    if(!await this.subjectsAllowed(reply.subjects))return;
    const text=this.formatReply(reply);const owner='author'in target?target.author.id:target.user.id;
    const components=this.buttons(reply,owner,target.channelId!);const chunks=text.match(/[\s\S]{1,1900}/g)||['No response.'];
    for(let n=0;n<chunks.length;n++){
      if(!await this.subjectsAllowed(reply.subjects))return;
      const options={content:chunks[n],components:n===chunks.length-1?components:[],allowedMentions:{parse:[] as [],repliedUser:false}};
      const msg='author'in target?await target.reply(options):n===0?await target.editReply(options):await target.followUp(options);
      if(this.disk.ready)await this.disk.put('outgoing',{channel:msg.channelId,message:msg.id},reply.subjects);
    }
  }
  private async onMessage(message:Message){
    if(!this.ready||!this.disk.ready||message.author.bot||!this.cfg.value.discord.channels.includes(message.channelId)||this.processing>=2)return;
    this.processing++;
    try{
      if(!await this.privacy.message(message))return;
      const member=await this.privacy.member(message.guild,message.author.id);if(!member)return;
      const linked=[...message.mentions.users.keys()].filter(id=>id!==this.client!.user!.id);
      if(message.reference?.messageId){const ref=await message.fetchReference();if(!ref.author.bot)linked.push(ref.author.id);}
      const actor=this.actor(member,message.channelId,linked),text=message.content,mentioned=message.mentions.has(this.client!.user!);
      this.seen.set(message.channelId,Date.now());
      if(this.cfg.value.moderation.enabled&&!this.roles.operator(member)){
        const finding=await this.moderation.evaluate(member.id,text,mentioned);
        if(finding&&await actor.authorize()){
          if(member.moderatable){
            await member.timeout(finding.minutes*60000,`BibiAI: ${finding.rule}`);
            if(this.cfg.value.vacation.enabled&&this.cfg.value.vacation.deleteMessages&&message.deletable)await message.delete();
            await this.disk.put('event',{type:'moderation',rule:finding.rule,severity:finding.severity,minutes:finding.minutes,previous:finding.previous},[member.id,...linked]);
            await this.notify(`Moderation: ${finding.rule}; ${finding.minutes} minute timeout.`,[member.id,...linked]);
          }
        }
      }
      if(mentioned&&this.cfg.value.discord.grudges&&/\b(bad bot|fatass|fat ass|stupid|idiot|fuck you|shut up)\b/i.test(text)){
        const grudge=await this.memory.grudge(member.id,member.displayName,text,linked);
        if(grudge&&Date.now()-grudge.data.lastReply>600000&&await actor.authorize()){
          await this.sendReply(message,{text:`Citizen, that goes in the ledger. Disrespect count: ${grudge.data.count}. I will still fix the server.`,subjects:grudge.subjects,commands:[]});
          await this.disk.put('grudge',{...grudge.data,lastReply:Date.now()},grudge.subjects,undefined,grudge.id);
        }
      }
      if(this.cfg.value.discord.sholom&&text.trim().toLowerCase()===this.cfg.value.discord.sholomWord.toLowerCase()&&member.voice.channel){if(await actor.authorize())await this.voice.play(member.voice.channel,this.cfg.value.discord.sholomFile);return;}
      if(!mentioned){
        if(this.cfg.value.discord.observe&&await actor.authorize())await this.memory.recent(text,'',[member.id,...linked],message.channelId,'discord');
        if(this.cfg.value.discord.chime&&!this.ai.gate.busy&&text.length>=12&&Date.now()-this.lastChime>this.cfg.value.discord.chimeMinutes*60000&&Math.random()<this.cfg.value.discord.chimeChance){
          this.lastChime=Date.now();await this.sendReply(message,await this.ai.chat(`Briefly join this conversation without pinging anyone: ${text}`,{...actor,operator:false}));
        }return;
      }
      if(!this.consume(member.id))return;
      if(/how.*join|what.*ip|where.*modpack/i.test(text)){await this.sendReply(message,{text:this.joinText(),subjects:[member.id],commands:[]});return;}
      if(this.cfg.value.vacation.enabled&&/where.*ben|who.*charge|what.*rules/i.test(text)){await this.sendReply(message,{text:this.vacationText(),subjects:[member.id],commands:[]});return;}
      // Discord's typing indicator makes the cloud-model wait visible without retaining more data.
      const showTyping=()=>{const pending=(message.channel as {sendTyping?:()=>Promise<unknown>}).sendTyping?.();void pending?.catch(()=>{});};
      const typing=setInterval(showTyping,7000);
      try{
        showTyping();
        const media=await this.media([...message.attachments.values()]);
        await this.sendReply(message,await this.ai.chat(text.replace(/<@!?\d+>/g,'').trim()||'Describe the attached media.',actor,media));
      }finally{clearInterval(typing);}
    }catch(e){if(await this.privacy.member(message.guild,message.author.id)&&message.mentions.has(this.client?.user!))await message.reply({content:cleanError(e),allowedMentions:{parse:[],repliedUser:false}}).catch(()=>{});}
    finally{this.processing--;}
  }
  private async onInteraction(i:Interaction){
    if(i.isChatInputCommand()&&i.commandName==='privacy'){await this.privacyCommand(i).catch(()=>{});return;}
    if(!this.ready||!this.disk.ready||this.processing>=2||!this.cfg.value.discord.channels.includes(i.channelId||''))return;
    this.processing++;
    try{
      const member=await this.privacy.member(i.guild,i.user.id);if(!member)return;
      const strings:string[]=[];const linked:string[]=[];
      if(i.isChatInputCommand()){
        const walk=(options:readonly any[])=>{for(const o of options){if(o.options)walk(o.options);else if(o.type===3)strings.push(String(o.value));else if(o.type===6)linked.push(String(o.value));}};
        walk(i.options.data);
        for(const text of strings){if(!await this.privacy.text(i.guild,text))return;linked.push(...Array.from(text.matchAll(/<@!?(\d{16,22})>/g),m=>m[1]));}
      }
      const actor=this.actor(member,i.channelId!,linked);
      if(i.isStringSelectMenu()&&i.customId==='roles:select'){await i.deferReply({ephemeral:true});await this.roles.select(i,member);await i.editReply('Your roles were updated.');return;}
      if(i.isButton()&&i.customId.startsWith('mc:')){
        await i.deferReply({ephemeral:true});const key=i.customId.slice(3),plan=this.pending.get(key);this.pending.delete(key);
        if(!plan||plan.owner!==member.id||Date.now()-plan.at>300000||!actor.operator||!await this.subjectsAllowed(plan.subjects))throw new Error('This confirmation expired or is not yours.');
        const results=[];for(const cmd of plan.commands){if(!await actor.authorize())throw new Error('Privacy preference changed.');results.push(await this.mc.execute(cmd,true));}
        await i.editReply(results.join('\n').slice(0,1900));return;
      }
      if(!i.isChatInputCommand())return;
      if(!this.consume(member.id,3)){await i.reply({content:'Please wait a few seconds.',ephemeral:true});return;}
      await i.deferReply({ephemeral:['memory','moderation','appeal','roles','rcon'].includes(i.commandName)});
      const sub=i.options.getSubcommand(false)||'';
      const requireOperator=()=>{if(!actor.operator)throw new Error('Operator permission is required.');};
      switch(i.commandName){
        case'ask':await this.sendReply(i,await this.ai.chat(i.options.getString('prompt',true),actor,await this.media(['image','video'].map(n=>i.options.getAttachment(n)).filter((a):a is Attachment=>Boolean(a)))));break;
        case'join':await i.editReply(this.joinText());break;
        case'memory':{
          requireOperator();
          if(sub==='add')await this.memory.fact(i.options.getString('text',true),[member.id,...linked],'discord');
          if(sub==='remove')await this.disk.delete(i.options.getString('id',true));
          if(sub==='clear')await this.memory.forgetAllFacts();
          const notes=await this.disk.rows('fact',12);await i.editReply(notes.map(r=>`${r.id}: ${r.data.text}`).join('\n').slice(0,1900)||'No durable notes saved.');break;
        }
        case'mc':{
          if(sub==='status'){await i.editReply((await this.mc.status()).summary.slice(0,1900));break;}
          requireOperator();
          if(sub==='fix')await this.sendReply(i,await this.ai.chat(`Diagnose and plan a fix: ${i.options.getString('issue',true)}`,actor));
          if(sub==='diagnostics'){const status=await this.mc.status(true);await i.editReply(status.summary.slice(0,1900));await this.disk.put('event',{type:'diagnostics'},[member.id]);}
          if(sub==='start'||sub==='recover')await i.editReply(await this.mc.power(sub==='start'));break;
        }
        case'rcon':{
          requireOperator();const p=commandPolicy(i.options.getString('command',true),this.cfg.value.minecraft.allowStop);
          if(p.risk==='blocked')throw new Error(p.reason);
          if(p.risk==='confirm')await this.sendReply(i,{text:'Review the command below.',subjects:[member.id],commands:[{command:p.command,reason:p.reason}]});
          else await i.editReply(await this.mc.execute(p.command));break;
        }
        case'roles':{
          if(sub==='menu'){await i.editReply({content:'Select the roles you want. Clearing the selection removes your self-select roles.',components:[await this.roles.menu(member.guild)]});break;}
          const target=await this.privacy.member(member.guild,i.options.getUser('user',true).id);if(!target)throw new Error('This member is unavailable for bot actions.');
          await this.roles.change(target,i.options.getRole('role',true).id,sub==='add',member,false);await i.editReply('Role updated.');break;
        }
        case'moderation':{
          requireOperator();const target=await this.privacy.member(member.guild,i.options.getUser('user',true).id);if(!target)throw new Error('This member is unavailable for bot actions.');
          const bot=await member.guild.members.fetchMe();await i.editReply(`Timeout permission: ${bot.permissions.has(PermissionsBitField.Flags.ModerateMembers)}\nCan moderate target: ${target.moderatable}\nOperator exemption: ${this.roles.operator(target)}\nDelete permission: ${bot.permissions.has(PermissionsBitField.Flags.ManageMessages)}`);break;
        }
        case'vacation':if(sub==='checkin'){requireOperator();await i.editReply(`${this.vacationText()}\n${(await this.mc.status()).summary}`.slice(0,1900));}else await i.editReply(this.vacationText());break;
        case'tts':{
          if(!actor.operator&&!this.cfg.value.discord.ttsRoles.some(id=>member.roles.cache.has(id)))throw new Error('A permitted TTS role is required.');
          if(sub==='leave'){this.voice.leave();await i.editReply('Left voice.');break;}
          if(!member.voice.channel)throw new Error('Join a voice channel first.');await i.editReply('Speaking in your voice channel.');await this.voice.say(member.voice.channel,i.options.getString('text',true));break;
        }
        case'listen':{
          if(!member.voice.channel)throw new Error('Join a voice channel first.');
          await i.editReply('Listening to your microphone only, for up to 15 seconds.');
          const audio=await this.voice.listen(member.voice.channel,member.id,actor.authorize);await this.sendReply(i,await this.ai.chat('Transcribe my spoken request and answer it.',actor,[{mimeType:'audio/wav',data:audio.toString('base64')}]));break;
        }
        case'snitch':await this.snitch(i,member,linked);break;
        case'appeal':{
          if(!this.appeals)throw new Error('Appeals are unavailable.');
          if(sub==='submit'){const row=await this.appeals.submit(member.id,i.options.getString('reason',true),i.options.getString('email')||'');await i.editReply(`Case ${row.id}. ${row.data.status==='unverified'?'Check your email to verify your address.':`Review due ${new Date(row.data.due).toUTCString()}.`}`);}
          else if(sub==='verify'){await this.appeals.verify(member.id,i.options.getString('case',true),i.options.getString('code',true));await i.editReply('Email verified. Your appeal is pending.');}
          else{const rows=await this.disk.rows('appeal',5,r=>r.subjects.includes(member.id));await i.editReply(rows.map(r=>`${r.id}: ${r.data.status}. ${r.data.decision||`Review due ${new Date(r.data.due).toUTCString()}`}`).join('\n')||'No appeals.');}break;
        }
      }
    }catch(e){if(i.isRepliable()&&await this.privacy.member(i.guild,i.user.id)){const msg={content:cleanError(e),ephemeral:true};if(i.deferred||i.replied)await i.editReply(msg).catch(()=>{});else await i.reply(msg).catch(()=>{});}}
    finally{this.processing--;}
  }
  private async privacyCommand(i:ChatInputCommandInteraction){
    if(!i.guild||i.guildId!==this.cfg.value.discord.guildId)return;
    const roleId=this.cfg.value.discord.privacyRole;if(!roleId)return;
    const sub=i.options.getSubcommand();await i.deferReply({ephemeral:true});
    try{
      const member=await i.guild.members.fetch({user:i.user.id,force:true,cache:false});
      if(sub==='restore'){
        if(!this.roles.operator(member))throw new Error('Operator permission is required.');
        const target=await i.guild.members.fetch({user:i.options.getUser('user',true).id,force:true,cache:false});
        const role=await i.guild.roles.fetch(roleId);
        if(!role||role.managed||role.id===i.guild.id||role.permissions.bitfield!==0n)throw new Error('Invalid privacy role.');
        if(target.roles.cache.has(roleId))await target.roles.remove(roleId,`Privacy mode restored by ${member.user.tag}`);
        const fresh=await i.guild.members.fetch({user:target.id,force:true,cache:false});
        if(fresh.roles.cache.has(roleId))throw new Error('The privacy role could not be removed. Check BibiAI role hierarchy.');
        await this.disk.consent(target.id);
        await i.editReply(`BibiAI processing was restored for ${target.user.tag}. Their previous BibiAI history remains deleted.`);
      }else if(sub==='optout'){
        await this.forget(member.id);
        try{
          const role=await i.guild.roles.fetch(roleId);
          if(!role||role.managed||role.id===i.guild.id||role.permissions.bitfield!==0n)throw new Error('Invalid privacy role.');
          await member.roles.add(roleId,'Explicit privacy opt-out');
        }catch{await i.editReply('Processing is blocked and your BibiAI records are queued for deletion. A moderator must configure or assign a privacy role with no permissions.');return;}
        await i.editReply('BibiAI has stopped processing your activity and erased its records about you. NAS-offline deletion completes when the volume reconnects.');
      }else if(sub==='optin'){
        if(member.roles.cache.has(roleId))await member.roles.remove(roleId,'Explicit privacy opt-in');const fresh=await i.guild.members.fetch({user:member.id,force:true,cache:false});
        if(fresh.roles.cache.has(roleId))throw new Error('The privacy role could not be removed.');await this.disk.consent(member.id);await i.editReply('Processing resumed. Your previous history stays deleted.');
      }else await i.editReply(member.roles.cache.has(roleId)||this.disk.blocked(member.id)?'BibiAI processing is off for you.':'BibiAI processing is on for you. Use /privacy optout to stop it.');
    }catch(e){await i.editReply(cleanError(e));}
  }
  private async snitch(i:ChatInputCommandInteraction,reporter:GuildMember,linked:string[]=[]){
    const c=this.cfg.value;if(!c.moderation.snitch)throw new Error('Snitch reports are disabled.');
    const target=await this.privacy.member(i.guild,i.options.getUser('user',true).id);
    if(!target||target.user.bot||target.id===reporter.id||this.roles.operator(target))throw new Error('This member is unavailable for snitch reports.');
    const subjects=[...new Set([reporter.id,target.id,...linked])];
    const recent=await this.disk.rows('event',1,r=>r.data.type==='snitch'&&r.subjects[0]===reporter.id&&r.at>Date.now()-300000);
    if(recent.length)throw new Error('Snitch cooldown is five minutes.');
    const reason=i.options.getString('reason',true),evidence=i.options.getString('evidence')||'';
    const files=['evidence_file','evidence_file_2','evidence_file_3'].map(n=>i.options.getAttachment(n)).filter((a):a is Attachment=>Boolean(a));
    let summary='';
    if(files.length){const media=await this.media(files);if(!await this.subjectsAllowed(subjects))return;summary=String((await this.ai.inspect(`${reason}\n${evidence}`,media)).summary||'').slice(0,1500);}
    if(!await this.subjectsAllowed(subjects))return;
    const finding=await this.moderation.evaluate(target.id,`${reason}\n${evidence}\n${summary}`,false,true);
    let applied=false;
    if(finding&&c.moderation.autoPunish&&target.moderatable){await target.timeout(finding.minutes*60000,`BibiAI report: ${finding.rule}`);applied=true;await this.disk.put('event',{type:'moderation',...finding},[target.id,...subjects]);}
    await this.disk.put('event',{type:'snitch',reason,evidence,summary,files:files.map(f=>({name:f.name,size:f.size,url:f.url})),finding,applied},subjects);
    await this.notify(`Snitch report: ${reason}\n${summary}\n${finding?`${finding.minutes} minutes; ${applied?'timeout applied':'recorded for staff'}`:'No automatic punishment: no clear rule signal.'}`,subjects,c.discord.snitchChannel||c.discord.reportChannel);
    await i.editReply(finding?`Report recorded. ${applied?`${finding.minutes}-minute timeout applied.`:'Staff review needed.'}`:'Report recorded for staff review. No automatic punishment.');
  }
  async tick(){
    if(!this.ready||!this.client||!this.disk.ready)return;
    this.moderation.sweep();for(const[k,p]of this.pending)if(Date.now()-p.at>300000)this.pending.delete(k);
    const c=this.cfg.value.discord,guild=this.client.guilds.cache.get(c.guildId);if(!guild)return;
    if(c.revive&&!this.ai.gate.busy&&Date.now()-this.lastRevive>c.reviveCooldownMinutes*60000){
      const channel=c.reviveChannel||c.channels[0];if(!this.seen.has(channel))this.seen.set(channel,Date.now());const last=this.seen.get(channel)!;
      if(Date.now()-last>c.reviveIdleMinutes*60000){
        this.lastRevive=Date.now();const ch=await this.client.channels.fetch(channel);
        if(ch?.isTextBased()&&'send'in ch)await ch.send({content:`${c.reviveEveryone?'@everyone ':''}The Honda Fit Republic requests signs of life. What is everyone building?`,allowedMentions:{parse:c.reviveEveryone?['everyone']:[]}});
      }
    }
    if(c.sholom&&c.sholomRandom&&Date.now()>this.nextSong){
      this.nextSong=Date.now()+(c.sholomMinMinutes+Math.random()*(c.sholomMaxMinutes-c.sholomMinMinutes))*60000;
      const channels=guild.channels.cache.filter(ch=>ch.isVoiceBased()&&ch.members.some(m=>!m.user.bot));
      const candidates=[...channels.values()].filter(ch=>ch.isVoiceBased()&&ch.permissionsFor(guild.members.me!)?.has([PermissionsBitField.Flags.Connect,PermissionsBitField.Flags.Speak]));
      const channel=candidates[Math.floor(Math.random()*candidates.length)];
      if(channel?.isVoiceBased()){
        let allowed=true;for(const member of channel.members.values())if(!member.user.bot&&!await this.privacy.member(guild,member.id)){allowed=false;break;}
        if(allowed)await this.voice.play(channel,c.sholomFile).catch(()=>{});
      }
    }
    // Compact one consenting speaker's observed chat at a time; no local model and no unbounded job queue.
    if(c.observe&&!this.ai.gate.busy){
      const rows=await this.disk.rows('recent',16,r=>r.data.source==='discord'&&!r.data.reply&&!r.data.summarized);
      const subject=rows[0]?.subjects[0];const same=rows.filter(r=>r.subjects.length===1&&r.subjects[0]===subject);
      if(subject&&same.length>=4&&await this.privacy.member(guild,subject)){
        await this.ai.extractObserved(subject,same.map(r=>r.data.text).join('\n'),async()=>Boolean(await this.privacy.member(guild,subject)));
        for(const row of same)await this.disk.delete(row.id);
      }
    }
  }
}
