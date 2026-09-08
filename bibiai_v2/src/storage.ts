import { mkdir, readdir, readFile, writeFile, rename, rm, stat, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID, createHmac, randomBytes } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { Configuration } from './config.js';
const compress = promisify(gzip), decompress = promisify(gunzip);
export type RecordKind = 'recent' | 'fact' | 'event' | 'grudge' | 'appeal' | 'outgoing' | 'state';
export type Row = { id: string; kind: RecordKind; at: number; expires: number; subjects: string[]; data: Record<string, any> };
const kinds: RecordKind[] = ['recent','fact','event','grudge','appeal','outgoing','state'];
const filename = /^[0-9a-f-]{36}\.json\.gz$/;
export class Storage {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private denied = new Set<string>();
  private salt = Buffer.alloc(0);
  private privacyWrite: Promise<void> | undefined;
  private privacyDirty = false;
  private index = new Map<string, { kind: RecordKind; at: number; expires: number; size: number }>();
  private root = '';
  ready = false;
  error = 'Set up the NAS volume to enable memory.';
  revision = 0;
  constructor(readonly cfg: Configuration) {}
  async localInit() {
    const p = join(this.cfg.dataDir, 'privacy-v2.json');
    try {
      const s = JSON.parse(await readFile(p, 'utf8')); this.salt = Buffer.from(s.salt, 'hex'); this.denied = new Set(s.denied);
      if (this.salt.length !== 32 || this.denied.size > 5000) throw new Error('Invalid privacy index.');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.salt = randomBytes(32); await this.savePrivacy();
    }
  }
  private async savePrivacy() {
    this.privacyDirty = true;
    if (!this.privacyWrite) {
      this.privacyWrite = (async () => {
        const p = join(this.cfg.dataDir, 'privacy-v2.json');
        while (this.privacyDirty) {
          this.privacyDirty = false;
          await writeFile(`${p}.tmp`, JSON.stringify({ salt: this.salt.toString('hex'), denied: [...this.denied] }), { mode: 0o600 });
          await rename(`${p}.tmp`, p);
        }
      })().finally(() => { this.privacyWrite = undefined; });
    }
    return this.privacyWrite;
  }
  key(subject: string) { return createHmac('sha256', this.salt).update(subject).digest('hex'); }
  blocked(subject: string) { return this.denied.has(this.key(subject)); }
  allowed(subjects: string[]) { return subjects.every(id => !this.blocked(id)); }
  private async serial<T>(fn: () => Promise<T>): Promise<T> {
    if (this.pending >= 8) throw new Error('Storage is busy; try again shortly.');
    this.pending++;
    const p = this.queue.catch(() => {}).then(fn); this.queue = p;
    try { return await p; } finally { this.pending--; }
  }
  async volumeCheck() {
    const path = resolve(this.cfg.value.memory.mountPath);
    const actual = await realpath(path); // Never create the mount itself: an absent NAS must not become a local folder.
    if (this.cfg.value.memory.requireNetworkMount && process.platform === 'linux') {
      const mounts = await readFile('/proc/mounts', 'utf8');
      const network = mounts.split('\n').some(line => {
        const f = line.split(' '); const mount = (f[1] || '').replace(/\\040/g, ' ');
        const rel = relative(mount, actual);
        return ['cifs','nfs','nfs4'].includes(f[2]) && !rel.startsWith('..') && !isAbsolute(rel);
      });
      if (!network) throw new Error('The selected path is not on a mounted Samba/NFS volume.');
    } else if (this.cfg.value.memory.requireNetworkMount) throw new Error('Network mount verification requires the Linux add-on.');
    return actual;
  }
  async initialize() {
    const mount = await this.volumeCheck();
    const root = join(mount, 'bibiai-v2');
    await mkdir(root, { recursive: true });
    const marker = join(root, '.volume-v2');
    try { await writeFile(marker, 'BibiAI v2\n', { flag: 'wx', mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    await this.connect();
  }
  async connect() {
    return this.serial(async () => {
      this.ready = false; this.index.clear();
      try {
        const mount = await this.volumeCheck(); this.root = join(mount, 'bibiai-v2');
        if ((await readFile(join(this.root, '.volume-v2'), 'utf8')).trim() !== 'BibiAI v2') throw new Error('Initialize this volume in the dashboard.');
        for (const kind of kinds) {
          await mkdir(join(this.root, kind), { recursive: true });
          const files = await readdir(join(this.root, kind));
          if (files.length > 6000) throw new Error('Volume exceeds the supported record budget.');
          for (const f of files) {
            if (!filename.test(f)) { if (f.endsWith('.tmp')) await rm(join(this.root, kind, f), { force: true }); continue; }
            const path = join(this.root, kind, f), size = (await stat(path)).size;
            const row = await this.readPath(path);
            if (row.kind !== kind || f !== `${row.id}.json.gz`) throw new Error('Invalid stored record.');
            if (row.expires <= Date.now() || !this.allowed(row.subjects)) { await rm(path); continue; }
            this.index.set(row.id, { kind, at: row.at, expires: row.expires, size });
          }
        }
        this.ready = true; this.error = ''; await this.prune();
      } catch (e) { this.error = (e as Error).message; throw e; }
    });
  }
  private path(kind: RecordKind, id: string) {
    if (!kinds.includes(kind) || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid storage key.');
    return join(this.root, kind, `${id}.json.gz`);
  }
  private async readPath(path: string): Promise<Row> {
    if ((await stat(path)).size > 32768) throw new Error('Oversized compressed record.');
    const buf = await decompress(await readFile(path), { maxOutputLength: 32768 });
    const r = JSON.parse(buf.toString('utf8'));
    if (!r || !Array.isArray(r.subjects) || r.subjects.length > 500 || !Number.isFinite(r.expires) || !r.data) throw new Error('Invalid record.');
    return r as Row;
  }
  private async available() {
    if (!this.ready) throw new Error(this.error || 'NAS storage is unavailable.');
    try { await this.volumeCheck(); await stat(join(this.root, '.volume-v2')); }
    catch { this.ready = false; this.error = 'NAS disconnected. Memory writes are paused.'; throw new Error(this.error); }
  }
  async put(kind: RecordKind, data: Row['data'], subjects: string[] = [], ttlHours?: number, id: string = randomUUID()): Promise<Row | null> {
    if (!this.cfg.value.memory.enabled && ['recent','fact','grudge'].includes(kind)) return null;
    return this.serial(async () => {
      await this.available();
      if (!this.allowed(subjects)) return null;
      const ttl = ttlHours ?? (kind === 'recent' ? this.cfg.value.memory.recentHours : kind==='appeal' ? Math.max(this.cfg.value.memory.eventsDays,this.cfg.value.appeals.businessDays*2+7)*24 : ['event','outgoing'].includes(kind) ? this.cfg.value.memory.eventsDays * 24 : this.cfg.value.memory.retentionDays * 24);
      const row: Row = { id, kind, at: Date.now(), expires: Date.now() + ttl * 3600000, subjects: [...new Set(subjects)], data };
      const raw = Buffer.from(JSON.stringify(row)); if (raw.length > 32768) throw new Error('Record exceeds the 32 KiB budget.');
      const zipped = await compress(raw, { level: 3 });
      const target = this.path(kind, id); const temp = `${target}.${randomUUID()}.tmp`;
      try { await writeFile(temp, zipped, { mode: 0o600 }); await rename(temp, target); }
      finally { await rm(temp, { force: true }).catch(() => {}); }
      this.index.set(id, { kind, at: row.at, expires: row.expires, size: zipped.length }); await this.prune();
      return row;
    });
  }
  async rows(kind: RecordKind, limit = 100, predicate?: (r: Row) => boolean): Promise<Row[]> {
    await this.available();
    const rows: Row[] = [];
    const candidates = [...this.index.entries()].filter(([, v]) => v.kind === kind && v.expires > Date.now()).sort((a, b) => b[1].at - a[1].at);
    for (const [id] of candidates) {
      try {
        const row = await this.readPath(this.path(kind, id));
        if (this.allowed(row.subjects) && (!predicate || predicate(row))) rows.push(row);
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      if (rows.length >= Math.min(limit, 2000)) break;
    }
    return rows;
  }
  async delete(id: string) { return this.serial(async () => { await this.available(); await this.remove(id); }); }
  private async remove(id: string) { const r = this.index.get(id); if (r) { await rm(this.path(r.kind, id), { force: true }); this.index.delete(id); } }
  private async prune() {
    for (const [id, r] of this.index) if (r.expires <= Date.now()) await this.remove(id);
    const limits: Record<RecordKind, number> = { recent: this.cfg.value.memory.recentLimit, fact: this.cfg.value.memory.factsLimit, event: 1000, grudge: 500, appeal: 200, outgoing: 1000, state: 50 };
    for (const kind of kinds) {
      const rows = [...this.index.entries()].filter(([, v]) => v.kind === kind).sort((a,b) => b[1].at - a[1].at);
      for (const [id] of rows.slice(limits[kind])) await this.remove(id);
    }
    const budget = this.cfg.value.memory.maxMiB * 1024 * 1024;
    let bytes = this.stats().bytes;
    // Recent conversations and event history yield space before curated facts.
    const ordered = [...this.index.entries()].sort((a,b) => (a[1].kind === 'fact' ? 1 : 0) - (b[1].kind === 'fact' ? 1 : 0) || a[1].at - b[1].at);
    for (const [id, row] of ordered) { if (bytes <= budget) break; await this.remove(id); bytes -= row.size; }
  }
  async maintenance() { return this.serial(async () => { await this.available(); await this.prune(); }); }
  async forget(subject: string, onErased?: (row: Row) => void) {
    // Tombstone first: an in-flight AI result can never write the deleted data back.
    if (this.denied.size >= 5000 && !this.blocked(subject)) throw new Error('Privacy index is full. Pause BibiAI and contact the owner.');
    this.denied.add(this.key(subject)); this.revision++;
    // Persist exclusions independently of the bounded NAS queue, even when it is saturated.
    await this.savePrivacy();
    return this.serial(async () => {
      if (!this.ready) return 0; // Deletion resumes on reconnect, before rows become accessible.
      let count = 0;
      for (const [id, v] of this.index) {
        const r = await this.readPath(this.path(v.kind, id));
        if (r.subjects.includes(subject) || JSON.stringify(r.data).includes(subject)) { onErased?.(r); await this.remove(id); count++; }
      }
      return count;
    });
  }
  async consent(subject: string) {
    return this.serial(async () => {
      await this.available();
      // Erase first, even if an earlier NAS outage delayed deletion. Consent never revives old records.
      for (const [id, v] of this.index) {
        const r=await this.readPath(this.path(v.kind,id));
        if(r.subjects.includes(subject)||JSON.stringify(r.data).includes(subject))await this.remove(id);
      }
      this.denied.delete(this.key(subject)); this.revision++; await this.savePrivacy();
    });
  }
  stats() { return { ready: this.ready, error: this.error, records: this.index.size, bytes: [...this.index.values()].reduce((n,v) => n+v.size, 0), maxBytes: this.cfg.value.memory.maxMiB * 1048576, pending: this.pending, counts: Object.fromEntries(kinds.map(k => [k, [...this.index.values()].filter(v => v.kind === k).length])) }; }
}
