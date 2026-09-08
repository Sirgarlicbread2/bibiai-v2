import { PermissionsBitField, ActionRowBuilder, StringSelectMenuBuilder, type Guild, type GuildMember, type StringSelectMenuInteraction } from 'discord.js';
import type { Configuration } from './config.js';
export function rolePermitted(input:{managed:boolean;permissions:bigint;position:number;botPosition:number;actorPosition?:number;selfService:boolean}){
  if(input.managed || input.position>=input.botPosition || (input.actorPosition!==undefined && input.position>=input.actorPosition)) return false;
  // Self-selected/automatic roles are cosmetic; an allowlist alone must never grant moderation powers.
  if(input.selfService && input.permissions!==0n) return false;
  return true;
}
export class Roles {
  constructor(readonly cfg:Configuration){}
  operator(member:GuildMember){return member.permissions.has(PermissionsBitField.Flags.Administrator)||member.permissions.has(PermissionsBitField.Flags.ManageGuild)||this.cfg.value.discord.adminRoles.some(id=>member.roles.cache.has(id));}
  async change(target:GuildMember,roleId:string,add:boolean,actor?:GuildMember,selfService=false){
    const guild=target.guild, bot=await guild.members.fetchMe(), role=await guild.roles.fetch(roleId);
    if(!role || role.id===guild.id || roleId===this.cfg.value.discord.privacyRole) throw new Error('Use the privacy controls for that role.');
    if(!bot.permissions.has(PermissionsBitField.Flags.ManageRoles)) throw new Error('BibiAI needs Manage Roles permission.');
    if(actor && (!actor.permissions.has(PermissionsBitField.Flags.ManageRoles) || (target.id!==actor.id && target.roles.highest.position>=actor.roles.highest.position && actor.id!==guild.ownerId))) throw new Error('Your role cannot manage that member.');
    if(!rolePermitted({managed:role.managed,permissions:role.permissions.bitfield,position:role.position,botPosition:bot.roles.highest.position,actorPosition:actor&&actor.id!==guild.ownerId?actor.roles.highest.position:undefined,selfService})) throw new Error('This role cannot be assigned here. Check permissions and role hierarchy.');
    if(add)await target.roles.add(role,'BibiAI role request');else await target.roles.remove(role,'BibiAI role request');
  }
  async menu(guild:Guild){
    await guild.roles.fetch();
    const bot=await guild.members.fetchMe();
    const roles=this.cfg.value.discord.selfRoles.map(id=>guild.roles.cache.get(id)).filter(r=>r&&r.id!==this.cfg.value.discord.privacyRole&&rolePermitted({managed:r.managed,permissions:r.permissions.bitfield,position:r.position,botPosition:bot.roles.highest.position,selfService:true})).slice(0,25);
    if(!roles.length)throw new Error('No eligible self-select roles are configured.');
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('roles:select').setPlaceholder('Choose your roles').setMinValues(0).setMaxValues(roles.length).addOptions(roles.map(r=>({label:r!.name.slice(0,100),value:r!.id}))));
  }
  async select(i:StringSelectMenuInteraction,member:GuildMember){
    const allowed=this.cfg.value.discord.selfRoles;
    if(i.values.some(id=>!allowed.includes(id)))throw new Error('That role menu is outdated.');
    for(const id of allowed){
      if(i.values.includes(id) && !member.roles.cache.has(id))await this.change(member,id,true,undefined,true);
      else if(!i.values.includes(id)&&member.roles.cache.has(id))await this.change(member,id,false,undefined,true);
    }
  }
  async auto(member:GuildMember){ for(const id of this.cfg.value.discord.autoRoles)await this.change(member,id,true,undefined,true); }
}
