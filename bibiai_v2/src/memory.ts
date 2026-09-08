import { createHash } from 'node:crypto';
import type { Configuration } from './config.js';
import { Storage, type Row } from './storage.js';
const secret = /(?:api[_ -]?key|password|bearer\s+|discord[_ -]?token|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,})/i;
export function compact(s: string, n = 600) { return s.replace(/\s+/g, ' ').trim().slice(0, n); }
export class Memory {
  constructor(readonly cfg: Configuration, readonly disk: Storage) {}
  async recent(text: string, reply: string, subjects: string[], channel = '', source = 'discord') {
    if (!this.cfg.value.memory.enabled || !this.disk.ready || secret.test(text + reply)) return;
    await this.disk.put('recent', { text: compact(text, 500), reply: compact(reply, 500), channel, source }, subjects);
  }
  async fact(text: string, subjects: string[], category = 'general') {
    text = compact(text, 500);
    if (!text || secret.test(text) || !this.disk.allowed(subjects)) return null;
    const hash = createHash('sha256').update(`${category}\0${subjects.slice().sort()}\0${text.toLowerCase()}`).digest('hex');
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
    return this.disk.put('fact', { text, category, source:category==='home'?'home':'discord' }, subjects, undefined, id);
  }
  async context(query: string, subject: string, channel = '', source = 'discord') {
    if (!this.disk.ready || !this.cfg.value.memory.enabled) return { text: '', subjects: [subject] };
    const recent = await this.disk.rows('recent', 8, r => r.data.source === source && (r.subjects.includes(subject) || Boolean(channel && r.data.channel === channel)));
    const tokens = new Set(query.toLowerCase().split(/\W+/).filter(t => t.length > 2));
    const facts = await this.disk.rows('fact', 2000, r => r.data.source === undefined || r.data.source === source);
    const ranked = facts.map(r => ({ row:r, score:(r.subjects.includes(subject) ? 3 : 0) + [...tokens].filter(t => String(r.data.text).toLowerCase().includes(t)).length }))
      .filter(x => x.score > 0 || !x.row.subjects.length).sort((a,b) => b.score-a.score).slice(0,12).map(x => x.row);
    const grudges = await this.disk.rows('grudge', 1, r => r.subjects[0] === subject);
    const rows = [...ranked,...recent,...grudges];
    // Provenance follows all source rows, including rows truncated from the prompt.
    return { text: rows.map(r => `[${r.kind}] ${JSON.stringify(r.data)}`).join('\n').slice(0,this.cfg.value.ai.maxContextChars), subjects:[...new Set([subject,...rows.flatMap(r => r.subjects)])] };
  }
  async grudge(subject: string, label: string, insult: string, linked: string[] = []) {
    const old = (await this.disk.rows('grudge',1,r => r.subjects[0] === subject))[0];
    const count = (old?.data.count || 0) + 1;
    return this.disk.put('grudge', { label:compact(label,80), count, insult:compact(insult,120), lastReply:old?.data.lastReply || 0,
      level:count >= 5 ? 'nemesis' : count >= 3 ? 'offended' : 'annoyed' }, [...new Set([subject,...linked,...(old?.subjects||[])])], undefined, old?.id);
  }
  async forgetAllFacts() { for (const row of await this.disk.rows('fact',2000)) await this.disk.delete(row.id); }
}
