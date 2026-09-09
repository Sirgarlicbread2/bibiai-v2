import { Configuration } from './config.js';
import { Storage } from './storage.js';
import { Memory } from './memory.js';
import { Minecraft } from './minecraft.js';
import { Home } from './home.js';
import { AI } from './ai.js';
import { Appeals } from './appeals.js';
import { cleanError } from './net.js';
import type { Discord } from './discord.js';
export class Runtime {
  readonly disk:Storage;readonly memory:Memory;readonly mc:Minecraft;readonly home:Home;readonly ai:AI;readonly appeals:Appeals;
  discord:Discord|undefined;
  started=Date.now();lastError='';
  private timer:NodeJS.Timeout|undefined;private ticking=false;private lastMonitor=0;private offline=0;private outageAttempted=false;private wasOnline:boolean|undefined;
  constructor(readonly cfg:Configuration){
    this.disk=new Storage(cfg);this.memory=new Memory(cfg,this.disk);this.mc=new Minecraft(cfg);this.home=new Home(cfg);this.ai=new AI(cfg,this.memory,this.mc,this.home);
    this.appeals=new Appeals(cfg,this.disk,this.ai,async id=>{if(!this.discord)throw new Error('Discord is unavailable.');await this.discord.untimeout(id);},async(t,s)=>{await this.discord?.notify(t,s);});
  }
  async init(){
    await this.disk.localInit();
    await this.disk.connect().catch(e=>{this.lastError=cleanError(e);});
    if(this.cfg.value.discord.enabled)await this.startDiscord().catch(e=>{this.lastError=cleanError(e);});
    this.timer=setInterval(()=>{void this.tick();},60000);this.timer.unref();
  }
  async startDiscord(){
    if(!this.discord){const {Discord}=await import('./discord.js');this.discord=new Discord(this.cfg,this.disk,this.memory,this.ai,this.mc);this.discord.appeals=this.appeals;}
    await this.discord.start();
  }
  async settings(input:unknown){
    // Stop before applying privacy/channel/role settings so no request uses a mixed configuration.
    this.discord?.stop();await this.cfg.save(input);await this.disk.connect().catch(e=>{this.lastError=cleanError(e);});
    if(this.cfg.value.discord.enabled)await this.startDiscord().catch(e=>{this.lastError=cleanError(e);});
  }
  async tick(){
    if(this.ticking)return;this.ticking=true;
    try{
      if(!this.disk.ready){await this.disk.connect();if(this.cfg.value.discord.enabled&&!this.discord?.client)await this.startDiscord();}
      await this.disk.maintenance();
      const c=this.cfg.value;
      if(c.minecraft.enabled&&Date.now()-this.lastMonitor>=c.minecraft.monitorMinutes*60000){
        this.lastMonitor=Date.now();const status=await this.mc.status();
        if(this.wasOnline!==status.online){await this.disk.put('event',{type:status.online?'minecraft_online':'minecraft_offline'});await this.discord?.notify(`Minecraft is ${status.online?'back online':'offline'}.`);}
        this.wasOnline=status.online;
        if(status.online){this.offline=0;this.outageAttempted=false;}else this.offline++;
        if(!status.online&&c.minecraft.recovery&&this.offline>=c.minecraft.offlineChecks&&!this.outageAttempted){
          this.outageAttempted=true;let outcome='Recovery request failed.';try{outcome=await this.mc.power();}catch{}
          await this.disk.put('event',{type:'minecraft_recovery',outcome});await this.discord?.notify(outcome);
        }
      }
      const now=new Date(),day=now.toISOString().slice(0,10);
      if(c.vacation.enabled&&c.vacation.dailyReport&&now.getUTCHours()>=c.vacation.reportHourUTC)await this.report('daily',day,1);
      if(c.minecraft.weeklyReport&&now.getUTCDay()===c.minecraft.reportDay&&now.getUTCHours()>=c.minecraft.reportHourUTC)await this.report('weekly',day,7);
      await this.discord?.tick();await this.appeals.tick();this.lastError='';
    }catch(e){this.lastError=cleanError(e);}finally{this.ticking=false;}
  }
  private async report(type:string,key:string,days:number){
    if(!this.discord||this.discord.status!=='Online'||!this.cfg.value.discord.reportChannel)return;
    const sent=(await this.disk.rows('state',1,r=>r.data.type===`report-${type}`))[0];if(sent?.data.key===key)return;
    const rows=await this.disk.rows('event',1000,r=>r.at>Date.now()-days*86400000);
    const counts:Record<string,number>={};for(const r of rows)counts[r.data.type]=(counts[r.data.type]||0)+1;
    const subjects=[...new Set(rows.flatMap(r=>r.subjects))];
    if(subjects.length>500)return;
    const sentNow=await this.discord.notify(`${type==='daily'?'Daily vacation check-in':'Weekly server report'}\n${Object.entries(counts).map(([k,v])=>`${k.replaceAll('_',' ')}: ${v}`).join('\n')||'No recorded events.'}\n${(await this.mc.status()).summary}`,subjects);
    if(!sentNow)return;
    await this.disk.put('state',{type:`report-${type}`,key},[],24*30,sent?.id);
  }
  status(){const m=process.memoryUsage();return{version:'2.0.4',uptimeSeconds:Math.floor((Date.now()-this.started)/1000),ramBytes:m.rss,heapBytes:m.heapUsed,aiBusy:this.ai.gate.busy,discord:this.discord?.status||'Disabled',storage:this.disk.stats(),lastError:this.lastError,demo:this.cfg.demo,secrets:this.cfg.secretStatus(),features:{discord:this.cfg.value.discord.enabled,home:this.cfg.value.home.enabled,email:this.cfg.value.appeals.emailEnabled,minecraft:this.cfg.value.minecraft.enabled}};}
  close(){if(this.timer)clearInterval(this.timer);this.discord?.stop();}
}
