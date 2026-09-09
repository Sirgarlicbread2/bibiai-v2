export async function fetchBounded(url: string, init: RequestInit = {}, maxBytes = 256 * 1024, timeout = 15000): Promise<Buffer> {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Remote service returned HTTP ${response.status}.`); }
  if (Number(response.headers.get('content-length') || 0) > maxBytes) { await response.body?.cancel(); throw new Error('Response exceeds size limit.'); }
  const chunks: Uint8Array[] = []; let size = 0;
  if (response.body) for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength; if (size > maxBytes) { throw new Error('Response exceeds size limit.'); } chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function jsonRequest(url: string, init: RequestInit = {}, maxBytes = 256 * 1024, timeout = 15000): Promise<any> {
  const result = await fetchBounded(url, init, maxBytes, timeout);
  return result.length ? JSON.parse(result.toString('utf8')) : {};
}
export function jsonPost(body: unknown, headers: Record<string,string> = {}): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
}
export class Gate {
  private running = false;
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running) throw new Error('BibiAI is working on another request. Try again shortly.');
    this.running = true;
    try { return await fn(); } finally { this.running = false; }
  }
  get busy() { return this.running; }
}
export function cleanError(e: unknown): string {
  if (e instanceof Error && /HTTP 429/.test(e.message)) return 'BibiAI is cooling down after too many Gemini requests. Try again in about a minute.';
  if (e instanceof Error && /privacy|consent|busy|NAS|configured|enabled|allow|confirm|limit|role|permission|request|storage|volume|timeout|HTTP|Time|Invalid|Choose|Connection|configured|failed|connect|Unavailable|token|Key/i.test(e.message)) return e.message.slice(0, 250);
  return 'The operation failed. Check the connection and settings.';
}
