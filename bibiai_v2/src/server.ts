import { createServer,type IncomingMessage,type ServerResponse } from 'node:http';
import { timingSafeEqual,randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Runtime } from './runtime.js';
import { SettingsSchema } from './config.js';
import { cleanError } from './net.js';
import { commandPolicy } from './minecraft.js';
export function bearerMatches(header:string|undefined,key:string){
  if(!key||key.length<24||!header?.startsWith('Bearer '))return false;
  const a=Buffer.from(header.slice(7)),b=Buffer.from(key);return a.length===b.length&&timingSafeEqual(a,b);
}
async function body(req:IncomingMessage){
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new Error('JSON request required.');
  const chunks:Buffer[]=[];let n=0;for await(const chunk of req){n+=chunk.length;if(n>32768)throw new Error('Request size limit exceeded.');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
}
function respond(res:ServerResponse,code:number,value:unknown){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
export function makeServer(runtime:Runtime,apiOnly=false){
  const failures=new Map<string,{at:number;count:number}>();
  return createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    let path='';
    try{
      const url=new URL(req.url||'/','http://localhost');path=url.pathname;
      if(path==='/health'){respond(res,200,{ok:true});return;}
      const remote=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
      const ingress=!apiOnly&&remote==='172.30.32.2';
      const assist=['/v1/assist','/v1/health'].includes(path)&&bearerMatches(req.headers.authorization,runtime.cfg.secrets.assist_key);
      const admin=!apiOnly&&(ingress||bearerMatches(req.headers.authorization,runtime.cfg.secrets.dashboard_key));
      if(!apiOnly&&req.method==='GET'&&['/','/app.js','/app.css'].includes(path)){
        const name=path==='/'?'index.html':path.slice(1);
        const file=await readFile(resolve('public',name));res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});res.end(file);return;
      }
      if(!admin&&!assist){
        const f=failures.get(remote);const row=f&&Date.now()-f.at<60000?f:{at:Date.now(),count:0};row.count++;if(failures.size>100)failures.clear();failures.set(remote,row);
        respond(res,row.count>10?429:401,{error:'Authentication required.'});return;
      }
      if(req.headers['sec-fetch-site']==='cross-site'){respond(res,403,{error:'Cross-site request blocked.'});return;}
      if(req.method!=='GET'&&admin&&req.headers['x-bibi-request']!=='1'){respond(res,403,{error:'Missing request header.'});return;}
      const input=req.method==='GET'?{}:await body(req);
      if(assist){
        if(path==='/v1/health'&&req.method==='GET'){respond(res,200,{ok:true,version:'2.0.0',enabled:runtime.cfg.value.home.enabled});return;}
        if(req.method!=='POST')throw new Error('POST required.');
        const b=z.object({text:z.string().min(1).max(4000),userId:z.string().min(1).max(100),conversationId:z.string().max(100).optional()}).parse(input);
        if(!runtime.cfg.value.home.enabled)throw new Error('Home Assistant is disabled.');
        const id=`ha:${b.userId}`,conversationId=b.conversationId||randomUUID();
        const result=await runtime.ai.chat(b.text,{id,source:'home',channel:conversationId,operator:false,authorize:async()=>runtime.cfg.value.home.enabled&&!runtime.disk.blocked(id)});
        respond(res,200,{text:result.text,conversationId});return;
      }
      if(!admin){respond(res,403,{error:'Insufficient access.'});return;}
      if(req.method==='GET'){
        if(path==='/api/status'){respond(res,200,runtime.status());return;}
        if(path==='/api/settings'){respond(res,200,{settings:runtime.cfg.value,schema:z.toJSONSchema(SettingsSchema),secrets:runtime.cfg.secretStatus()});return;}
        if(path==='/api/minecraft'){respond(res,200,await runtime.mc.status(false));return;}
        if(path==='/api/records'){
          const kind=z.enum(['recent','fact','event','grudge','appeal']).parse(url.searchParams.get('kind')||'fact');
          const query=(url.searchParams.get('q')||'').slice(0,100).toLowerCase();const offset=Math.max(0,Math.min(2000,Number(url.searchParams.get('offset'))||0));
          const rows=runtime.disk.ready?await runtime.disk.rows(kind,Math.min(offset+51,2000),r=>!query||JSON.stringify(r.data).toLowerCase().includes(query)):[];
          // Email verification secrets and worker tokens never appear in the dashboard record list.
          const items=rows.slice(offset,offset+50).map(r=>({...r,data:Object.fromEntries(Object.entries(r.data).filter(([k])=>!['verifyHash','token'].includes(k)))}));
          respond(res,200,{items,hasMore:rows.length>offset+50});return;
        }
        if(path==='/api/discord-options'){
          const guild=runtime.discord?.client?.guilds.cache.get(runtime.cfg.value.discord.guildId);
          respond(res,200,{roles:guild?[...guild.roles.cache.values()].map(r=>({id:r.id,name:r.name})):[],channels:guild?[...guild.channels.cache.values()].filter(c=>c.isTextBased()).map(c=>({id:c.id,name:c.name})):[]});return;
        }
      }
      if(req.method==='POST'){
        switch(path){
          case'/api/settings':await runtime.settings(input);respond(res,200,{saved:true});return;
          case'/api/storage/initialize':await runtime.disk.initialize();respond(res,200,runtime.disk.stats());return;
          case'/api/storage/reconnect':await runtime.disk.connect();respond(res,200,runtime.disk.stats());return;
          case'/api/discord/start':await runtime.startDiscord();respond(res,200,runtime.status());return;
          case'/api/discord/stop':runtime.discord?.stop();respond(res,200,runtime.status());return;
          case'/api/memory/add':{const b=z.object({text:z.string().min(1).max(500),subject:z.string().max(100).default('dashboard')}).parse(input);await runtime.memory.fact(b.text,[b.subject||'dashboard']);respond(res,200,{saved:true});return;}
          case'/api/records/delete':await runtime.disk.delete(z.string().uuid().parse(input.id));respond(res,200,{deleted:true});return;
          case'/api/privacy/forget':{const id=z.string().min(1).max(100).parse(input.id);if(runtime.discord)await runtime.discord.forget(id);else await runtime.disk.forget(id);respond(res,200,{deleted:true});return;}
          case'/api/chat':{const b=z.object({text:z.string().min(1).max(4000)}).parse(input);respond(res,200,await runtime.ai.chat(b.text,{id:'dashboard',source:'dashboard',operator:true,authorize:async()=>true}));return;}
          case'/api/minecraft/command':{const b=z.object({command:z.string().max(200),confirmed:z.boolean().default(false)}).parse(input);const p=commandPolicy(b.command,runtime.cfg.value.minecraft.allowStop);respond(res,200,{result:await runtime.mc.execute(p.command,b.confirmed)});return;}
          case'/api/minecraft/power':respond(res,200,{result:await runtime.mc.power(input.action==='start')});return;
          case'/api/appeals/decide':{const b=z.object({id:z.string().uuid(),decision:z.enum(['grant','deny']),reason:z.string().min(1).max(1000)}).parse(input);await runtime.appeals.decide(b.id,b.decision,b.reason);respond(res,200,{saved:true});return;}
        }
      }
      respond(res,404,{error:'Not found.'});
    }catch(e){respond(res,400,{error:e instanceof z.ZodError?'Invalid input. Check the field values.':cleanError(e)});}
  });
}
