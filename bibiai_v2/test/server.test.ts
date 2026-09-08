import { afterEach,it,expect } from 'vitest';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Configuration } from '../src/config.js';
import { Runtime } from '../src/runtime.js';
import { makeServer,bearerMatches } from '../src/server.js';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
async function fixture(apiOnly=false){
  const dir=await mkdtemp(join(tmpdir(),'bibi-http-test-')),cfg=new Configuration();Object.defineProperty(cfg,'dataDir',{value:dir});cfg.value.memory.mountPath=join(dir,'nas');cfg.value.memory.requireNetworkMount=false;
  cfg.secrets.dashboard_key='a'.repeat(32);cfg.secrets.assist_key='b'.repeat(32);await mkdir(cfg.value.memory.mountPath);
  const rt=new Runtime(cfg);await rt.disk.localInit();await rt.disk.initialize();
  const server=makeServer(rt,apiOnly);await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  cleanup.push(async()=>{rt.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(dir,{recursive:true,force:true});});
  return{rt,url:`http://127.0.0.1:${(server.address()as AddressInfo).port}`,headers:{Authorization:`Bearer ${cfg.secrets.dashboard_key}`,'Content-Type':'application/json','X-Bibi-Request':'1'}};
}
it('rejects missing, short, or mismatched keys',()=>{expect(bearerMatches('Bearer short','short')).toBe(false);expect(bearerMatches(undefined,'x'.repeat(32))).toBe(false);expect(bearerMatches(`Bearer ${'x'.repeat(32)}`,'x'.repeat(32))).toBe(true);});
it('protects records/settings and does not trust spoofed ingress headers',async()=>{const f=await fixture();expect((await fetch(f.url+'/api/settings')).status).toBe(401);expect((await fetch(f.url+'/api/status',{headers:{'X-Forwarded-For':'172.30.32.2','X-Ingress-Path':'/'}})).status).toBe(401);});
it('returns setup and status without secret values',async()=>{const f=await fixture();const r=await fetch(f.url+'/api/settings',{headers:f.headers});expect(r.status).toBe(200);const text=await r.text();expect(text).not.toContain('a'.repeat(32));expect(JSON.parse(text).secrets.dashboard_key).toBe(true);});
it('rejects cross-site writes and missing CSRF headers',async()=>{const f=await fixture();expect((await fetch(f.url+'/api/memory/add',{method:'POST',headers:{Authorization:f.headers.Authorization,'Content-Type':'application/json'},body:'{"text":"test"}'})).status).toBe(403);expect((await fetch(f.url+'/api/memory/add',{method:'POST',headers:{...f.headers,'Sec-Fetch-Site':'cross-site'},body:'{"text":"test"}'})).status).toBe(403);});
it('creates, lists, and erases linked records through authenticated APIs',async()=>{const f=await fixture();let r=await fetch(f.url+'/api/memory/add',{method:'POST',headers:f.headers,body:JSON.stringify({text:'Copper station',subject:'person'})});expect(r.status).toBe(200);r=await fetch(f.url+'/api/records?kind=fact',{headers:f.headers});expect((await r.json()).items).toHaveLength(1);r=await fetch(f.url+'/api/privacy/forget',{method:'POST',headers:f.headers,body:JSON.stringify({id:'person'})});expect(r.status).toBe(200);expect(await f.rt.disk.rows('fact')).toEqual([]);});
it('isolates Assist credentials from admin routes',async()=>{const f=await fixture(true);expect((await fetch(f.url+'/api/status',{headers:f.headers})).status).toBe(401);expect((await fetch(f.url+'/api/settings',{headers:{Authorization:`Bearer ${'b'.repeat(32)}`}})).status).toBe(401);});
it('supports the authenticated Assist setup health check',async()=>{const f=await fixture(true);expect((await fetch(f.url+'/v1/health')).status).toBe(401);const response=await fetch(f.url+'/v1/health',{headers:{Authorization:`Bearer ${'b'.repeat(32)}`}});expect(response.status).toBe(200);expect((await response.json()).version).toBe('2.0.0');});
it('has no printer endpoint',async()=>{const f=await fixture();expect((await fetch(f.url+'/api/fabrication/print',{method:'POST',headers:f.headers,body:'{}'})).status).toBe(404);});
it('rejects oversized request bodies',async()=>{const f=await fixture();expect((await fetch(f.url+'/api/memory/add',{method:'POST',headers:f.headers,body:JSON.stringify({text:'x'.repeat(40000)})})).status).toBe(400);});
