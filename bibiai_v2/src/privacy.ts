import type { Guild, GuildMember, Message } from 'discord.js';
import type { Configuration } from './config.js';
import type { Storage } from './storage.js';
export function hasPrivacyRole(roles: Iterable<string>, privacyRole:string) { return !privacyRole || [...roles].includes(privacyRole); }
export class Privacy {
  constructor(readonly cfg:Configuration,readonly disk:Storage){}
  async member(guild:Guild|null,id:string):Promise<GuildMember|null>{
    if(!guild || guild.id!==this.cfg.value.discord.guildId || !this.cfg.value.discord.privacyRole) return null;
    try {
      const member=await guild.members.fetch({user:id,force:true,cache:false});
      if(hasPrivacyRole(member.roles.cache.keys(),this.cfg.value.discord.privacyRole)){
        if(!this.disk.blocked(id)) await this.disk.forget(id); return null;
      }
      // A tombstone stays until explicit opt-in. Removing a role by accident cannot resurrect processing.
      return this.disk.blocked(id)?null:member;
    }catch{return null;}
  }
  async message(message:Message){
    if(!await this.member(message.guild,message.author.id)) return false;
    for(const id of message.mentions.users.keys()) if(id!==message.client.user?.id && !await this.member(message.guild,id)) return false;
    if(message.reference?.messageId){
      try { const referenced=await message.fetchReference(); if(!referenced.author.bot && !await this.member(message.guild,referenced.author.id)) return false; }
      catch { return false; }
    }
    return true;
  }
  async text(guild:Guild|null,text:string){
    const ids=[...new Set(Array.from(text.matchAll(/<@!?(\d{16,22})>/g),m=>m[1]))];
    if(ids.length>20)return false;
    for(const id of ids)if(id!==guild?.client.user.id&&!await this.member(guild,id))return false;
    return true;
  }
  async validateStored(guild:Guild){
    // At restart, reconcile known Discord subjects before the bot accepts any content.
    const ids=new Set<string>();
    for(const kind of ['recent','fact','event','grudge','appeal'] as const) for(const row of await this.disk.rows(kind,2000)) for(const id of row.subjects) if(/^\d{16,22}$/.test(id)) ids.add(id);
    for(const id of ids) if(!await this.member(guild,id) && !this.disk.blocked(id)) await this.disk.forget(id);
  }
}
