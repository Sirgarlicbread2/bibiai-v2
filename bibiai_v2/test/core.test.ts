import { mkdtemp,mkdir,rm,rename,readdir,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach,describe,it,expect,vi } from 'vitest';
import { Configuration,SettingsSchema } from '../src/config.js';
import { Storage } from '../src/storage.js';
import { Memory } from '../src/memory.js';
import { commandPolicy } from '../src/minecraft.js';
import { rolePermitted } from '../src/roles.js';
import { hasPrivacyRole,Privacy } from '../src/privacy.js';
import { businessDeadline } from '../src/appeals.js';
import { classify } from '../src/moderation.js';
import { AI } from '../src/ai.js';
import { commands } from '../src/commands.js';
const paths:string[]=[];
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'bibi-v2-test-'));paths.push(dir);
  const cfg=new Configuration();Object.defineProperty(cfg,'dataDir',{value:dir});
  cfg.value=SettingsSchema.parse({memory:{mountPath:join(dir,'nas'),requireNetworkMount:false,recentLimit:20,factsLimit:20}});
  await mkdir(cfg.value.memory.mountPath);const disk=new Storage(cfg);await disk.localInit();await disk.initialize();
  return {cfg,disk,memory:new Memory(cfg,disk),dir};
}
afterEach(async()=>{vi.restoreAllMocks();for(const p of paths.splice(0))await rm(p,{recursive:true,force:true});});
describe('fresh, bounded NAS memory',()=>{
  it('uses low-latency defaults for ordinary chat',()=>{const cfg=new Configuration();expect(cfg.value.ai).toMatchObject({model:'gemini-3.5-flash-lite',maxContextChars:4000,responseTokens:500});});
  it('grants revocable music and web privileges with a music baseline',()=>{const cfg=new Configuration();expect(cfg.value.privileges).toMatchObject({musicKnowledge:true,googleSearch:true});expect(cfg.value.privileges.musicTaste).toContain('Radiohead');expect(cfg.value.privileges.musicTaste).toContain('C418');});
  it('starts empty and does not import v1 files',async()=>{const f=await fixture();await writeFile(join(f.cfg.value.memory.mountPath,'bibiai-memory.json'),'old');expect(await f.disk.rows('fact')).toEqual([]);});
  it('deduplicates durable facts and preserves them across a restart',async()=>{const f=await fixture();await f.memory.fact('The rail station is copper.',['person']);await f.memory.fact('The rail station is copper.',['person']);expect(f.disk.stats().counts.fact).toBe(1);const fresh=new Storage(f.cfg);await fresh.localInit();await fresh.connect();expect((await fresh.rows('fact'))[0].data.text).toContain('copper');});
  it('caps recent record count and never saves media blobs',async()=>{const f=await fixture();for(let i=0;i<30;i++)await f.memory.recent(`message ${i}`,'answer',['person']);expect(f.disk.stats().counts.recent).toBe(20);expect(f.disk.stats().bytes).toBeLessThan(12000);});
  it('rejects secrets and oversized records',async()=>{const f=await fixture();expect(await f.memory.fact('my password is secret',['person'])).toBeNull();await expect(f.disk.put('fact',{text:'x'.repeat(40000)})).rejects.toThrow('32 KiB');});
  it('expires rows and avoids loading expired content',async()=>{const f=await fixture();await f.disk.put('recent',{text:'expired'},['person'],-1);expect(await f.disk.rows('recent')).toEqual([]);expect(f.disk.stats().counts.recent).toBe(0);});
  it('fails closed when the mount disappears without recreating it',async()=>{const f=await fixture();await rename(f.cfg.value.memory.mountPath,`${f.cfg.value.memory.mountPath}-offline`);await expect(f.memory.fact('new note',['person'])).rejects.toThrow('NAS');expect(f.disk.ready).toBe(false);expect(await readdir(f.dir)).not.toContain('nas');});
  it('erases derived data, keeps unrelated records, and blocks future writes',async()=>{const f=await fixture();await f.memory.fact('Shared project',['alice','bob']);await f.memory.fact('Other project',['carol']);await f.disk.put('event',{type:'snitch'},['bob','alice']);await f.disk.forget('alice');expect(await f.disk.rows('event')).toEqual([]);expect((await f.disk.rows('fact')).map(r=>r.data.text)).toEqual(['Other project']);expect(await f.memory.fact('Do not restore',['alice'])).toBeNull();const privacy=await readFile(join(f.dir,'privacy-v2.json'),'utf8');expect(privacy).not.toContain('alice');});
  it('keeps a tombstone over restart and opt-in cannot resurrect offline data',async()=>{const f=await fixture();await f.memory.fact('Old data',['alice']);await rename(f.cfg.value.memory.mountPath,`${f.cfg.value.memory.mountPath}-offline`);await expect(f.disk.maintenance()).rejects.toThrow();await f.disk.forget('alice');await expect(f.disk.consent('alice')).rejects.toThrow();await rename(`${f.cfg.value.memory.mountPath}-offline`,f.cfg.value.memory.mountPath);const fresh=new Storage(f.cfg);await fresh.localInit();await fresh.connect();expect(fresh.blocked('alice')).toBe(true);expect(await fresh.rows('fact')).toEqual([]);await fresh.consent('alice');expect(fresh.blocked('alice')).toBe(false);expect(await fresh.rows('fact')).toEqual([]);});
  it('serializes accepted concurrent writes without losing records',async()=>{const f=await fixture();await Promise.all(Array.from({length:8},(_,i)=>f.disk.put('event',{n:i},['person'])));expect((await f.disk.rows('event')).length).toBe(8);});
  it('persists opt-out even when the NAS write queue is full',async()=>{const f=await fixture();(f.disk as any).pending=8;await expect(f.disk.forget('alice')).rejects.toThrow('busy');const fresh=new Storage(f.cfg);await fresh.localInit();expect(fresh.blocked('alice')).toBe(true);});
  it('keeps simultaneous exclusions durable',async()=>{const f=await fixture();await Promise.all(['alice','bob','carol'].map(id=>f.disk.forget(id)));const fresh=new Storage(f.cfg);await fresh.localInit();for(const id of ['alice','bob','carol'])expect(fresh.blocked(id)).toBe(true);});
  it('erases grudges derived from mentions without confusing the owner',async()=>{const f=await fixture();await f.memory.grudge('alice','Alice','insult involving Bob',['bob']);await f.memory.grudge('bob','Bob','separate insult');expect((await f.disk.rows('grudge')).map(r=>r.data.count)).toEqual([1,1]);await f.disk.forget('bob');expect(await f.disk.rows('grudge')).toEqual([]);});
  it('keeps Home Assistant memory out of Discord context',async()=>{const f=await fixture();await f.memory.fact('Alarm action is private',['ha:owner'],'home');await f.memory.fact('Minecraft rail is copper',['person'],'discord');const context=await f.memory.context('private alarm copper','person','','discord');expect(context.text).not.toContain('Alarm');expect(context.text).toContain('copper');});
  it('bounds SMB fact reads during context retrieval',async()=>{const f=await fixture();f.cfg.value.memory.factsLimit=200;for(let i=0;i<120;i++)await f.memory.fact(`Fact ${i}`,['person'],'discord');const read=vi.spyOn(f.disk as any,'readPath');await f.memory.context('fact','person','','discord');expect(read).toHaveBeenCalledTimes(96);});
});
describe('permission boundaries',()=>{
  it.each(['op bob','give bob diamond 64','execute as @a run op bob','save-all\nstop','say hi;op bob','fill 0 0 0 1 1 1 air'])('blocks unsafe RCON: %s',command=>{expect(commandPolicy(command,true).risk).toBe('blocked');});
  it('separates read, safe, and confirmation commands',()=>{expect(commandPolicy('list').risk).toBe('read');expect(commandPolicy('save-all').risk).toBe('safe');expect(commandPolicy('kick bob').risk).toBe('confirm');expect(commandPolicy('stop').risk).toBe('blocked');expect(commandPolicy('stop',true).risk).toBe('confirm');});
  it('cannot self-assign permission-bearing or higher roles',()=>{const a={managed:false,permissions:0n,position:2,botPosition:5,selfService:true};expect(rolePermitted(a)).toBe(true);expect(rolePermitted({...a,permissions:8n})).toBe(false);expect(rolePermitted({...a,position:5})).toBe(false);expect(rolePermitted({...a,actorPosition:2})).toBe(false);expect(rolePermitted({...a,managed:true})).toBe(false);});
  it('fails closed if privacy role settings or membership lookup are missing',async()=>{expect(hasPrivacyRole([],'')).toBe(true);expect(hasPrivacyRole(['privacy'],'privacy')).toBe(true);const f=await fixture();const privacy=new Privacy(f.cfg,f.disk);expect(await privacy.member(null,'person')).toBeNull();});
  it('requires explicit opt-in even after the privacy role is removed',async()=>{const f=await fixture();f.cfg.value.discord.guildId='g';f.cfg.value.discord.privacyRole='p';await f.disk.forget('alice');const guild:any={id:'g',members:{fetch:async()=>({roles:{cache:new Map()}})}};expect(await new Privacy(f.cfg,f.disk).member(guild,'alice')).toBeNull();});
  it('requires configured channels and a privacy role to enable Discord',async()=>{const f=await fixture();const next=structuredClone(f.cfg.value);next.discord.enabled=true;await expect(f.cfg.save(next)).rejects.toThrow('privacy role');});
  it('contains no fabrication settings or keys',()=>{const cfg=new Configuration();expect('fabrication'in cfg.value).toBe(false);expect(Object.keys(cfg.secrets).some(k=>/fabrication|detector/.test(k))).toBe(false);});
  it('provides operators a privacy restore command',()=>{const privacy=commands.find((command:any)=>command.name==='privacy') as any;expect(privacy.options.some((option:any)=>option.name==='restore'&&option.options[0].name==='user')).toBe(true);});
});
describe('AI privacy races',()=>{
  it('does not call the AI for an excluded actor',async()=>{const f=await fixture();const ai=new AI(f.cfg,f.memory,{} as any,{} as any);const generate=vi.spyOn(ai,'generate');await expect(ai.chat('hello',{id:'alice',source:'discord',operator:false,authorize:async()=>false})).rejects.toThrow('Privacy');expect(generate).not.toHaveBeenCalled();});
  it('discards results when someone opts out during an AI request',async()=>{const f=await fixture();const ai=new AI(f.cfg,f.memory,{} as any,{} as any);vi.spyOn(ai,'generate').mockImplementation(async()=>{await f.disk.forget('alice');return JSON.stringify({reply:'answer',facts:['Should not persist'],actions:[]});});await expect(ai.chat('hello',{id:'alice',source:'discord',operator:false,authorize:async()=>true})).rejects.toThrow('Privacy');expect(await f.disk.rows('fact')).toEqual([]);});
  it('never runs Home Assistant actions from Discord',async()=>{const f=await fixture();const act=vi.fn();const ai=new AI(f.cfg,f.memory,{} as any,{act}as any);vi.spyOn(ai,'generate').mockResolvedValueOnce(JSON.stringify({reply:'request',facts:[],actions:[{type:'ha_action',value:'Turn on light'}]})).mockResolvedValueOnce(JSON.stringify({reply:'Unavailable',facts:[],actions:[]}));await ai.chat('Turn on light',{id:'alice',source:'discord',operator:true,authorize:async()=>true});expect(act).not.toHaveBeenCalled();});
});
describe('moderation and appeals',()=>{
  it('uses weekdays for appeal timing',()=>{expect(new Date(businessDeadline(Date.parse('2026-09-04T12:00:00Z'),1)).toISOString()).toBe('2026-09-07T12:00:00.000Z');expect(new Date(businessDeadline(Date.parse('2026-09-04T12:00:00Z'),5)).toISOString()).toBe('2026-09-11T12:00:00.000Z');});
  it('starts with evidence-based appeal standards and human decisions',()=>{const cfg=new Configuration();expect(cfg.value.appeals.automaticDecision).toBe(false);expect(cfg.value.appeals.emailConversation).toBe(true);expect(cfg.value.appeals.decisionStandards).toContain('reliable evidence');});
  it('distinguishes rule signals and supports custom terms',()=>{expect(classify('hello')).toBeNull();expect(classify('spamming nsfw')?.severity).toBe(2);expect(classify('ddos')?.severity).toBe(3);expect(classify('custom banned phrase',['banned phrase'])?.severity).toBe(2);});
});
