import { createConnection } from 'node:net';
import { open } from 'node:fs/promises';
import type { Configuration } from './config.js';
import { jsonRequest, jsonPost } from './net.js';
export type Policy = { command: string; risk:'read'|'safe'|'confirm'|'blocked'; reason: string };
export function commandPolicy(input: string, allowStop = false): Policy {
  const c = input.trim().replace(/^\//,'').replace(/ +/g,' ');
  const result = (risk: Policy['risk'], reason:string):Policy => ({command:c,risk,reason});
  if (!c || c.length > 200 || /[\r\n;|&`\x00]/.test(c)) return result('blocked','Only one Minecraft command is allowed.');
  if (/^(list|tps|mspt|version|weather query|time query (daytime|gametime|day))$/i.test(c)) return result('read','Status query');
  if (/^(say .{1,150}|save-all(?: flush)?|weather clear|gamerule do(?:Daylight|Weather)Cycle true|time set (day|noon|night|midnight)|whitelist reload)$/i.test(c)) return result('safe','Routine server operation');
  if (/^(kill @e\[type=(item|experience_orb)\]|kick [A-Za-z0-9_]{1,16}|whitelist (add|remove) [A-Za-z0-9_]{1,16}|difficulty (peaceful|easy|normal|hard))$/i.test(c) || (allowStop && c === 'stop')) return result('confirm','Operator confirmation required');
  return result('blocked','This command is outside the allowlist.');
}
export class Minecraft {
  constructor(readonly cfg: Configuration) {}
  async execute(input:string, confirmed = false) {
    const c = this.cfg.value.minecraft;
    if (!c.enabled || !c.host || !this.cfg.secrets.rcon_password) throw new Error('Minecraft RCON is not configured.');
    const p = commandPolicy(input,c.allowStop);
    if (p.risk === 'blocked' || (p.risk === 'confirm' && !confirmed)) throw new Error(p.reason);
    const { Rcon } = await import('rcon-client');
    const rcon = await Rcon.connect({host:c.host,port:c.rconPort,password:this.cfg.secrets.rcon_password,timeout:5000});
    try { return String(await rcon.send(p.command)).slice(0,4000); } finally { await rcon.end(); }
  }
  async status(logs = false) {
    const c = this.cfg.value.minecraft;
    if (!c.enabled || !c.host) return { enabled:false, online:false, summary:'Minecraft is not configured.' };
    const online = await new Promise<boolean>(done => {
      const s = createConnection({host:c.host,port:c.port});
      const finish = (v:boolean) => {s.destroy(); done(v);};
      s.setTimeout(3000); s.once('connect',()=>finish(true)); s.once('timeout',()=>finish(false)); s.once('error',()=>finish(false));
    });
    const details: Record<string,string> = {};
    if (online) for (const cmd of ['list','tps','mspt','version']) {
      try { details[cmd] = await this.execute(cmd); } catch { details[cmd] = 'Unavailable'; }
    }
    if (logs && c.logPath) {
      const file = await open(c.logPath,'r');
      try { const size=(await file.stat()).size; const bytes=Buffer.alloc(Math.min(size,16384)); await file.read(bytes,0,bytes.length,Math.max(0,size-bytes.length)); details.logs=bytes.toString('utf8').split('\n').slice(-80).join('\n'); }
      finally { await file.close(); }
    }
    return { enabled:true, online, details, summary:`Minecraft ${online?'online':'offline'}. ${Object.entries(details).map(([k,v])=>`${k}: ${v}`).join('\n')}` };
  }
  async power(startOnly = false) {
    const c = this.cfg.value.minecraft;
    if (c.pebbleId && this.cfg.secrets.pebble_token) {
      if (!/^[a-zA-Z0-9-]+$/.test(c.pebbleId)) throw new Error('Invalid PebbleHost identifier.');
      await jsonRequest(`https://panel.pebblehost.com/api/client/servers/${c.pebbleId}/power`,jsonPost({signal:startOnly?'start':c.recoverySignal},{Authorization:`Bearer ${this.cfg.secrets.pebble_token}`}));
      return 'Panel power request accepted.';
    }
    if (!startOnly && c.recoveryWebhook) { await jsonRequest(c.recoveryWebhook,jsonPost({action:'recover'})); return 'Recovery webhook accepted.'; }
    throw new Error('Server recovery is not configured.');
  }
}
