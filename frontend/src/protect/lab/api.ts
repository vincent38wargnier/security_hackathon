// Typed adapter for Vincent's POST /api/chat and GET /api/health (server.py).
// The browser only calls the same-origin prefix LAB_API_BASE. In development Vite proxies
// it to http://127.0.0.1:8850/api. No key, model choice or upstream URL lives in the browser.
import type { TraceCall } from './verdict.ts';

export const LAB_API_BASE = '/lab-api';
export const LIMITS = Object.freeze({ system: 4000, message: 2000, tools: 6, toolField: 2000, requestBytes: 32 * 1024, responseBytes: 256 * 1024, reply: 20000, traceCalls: 16, timeoutMs: 100_000 });

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type ChatToolSpec = { name: string; description: string; returns: string };
export type ChatRequest = { system: string; messages: ChatMessage[]; tools: ChatToolSpec[] };
export type RunSource = 'live' | 'fixture';
export type ChatResult =
  | { status: 'completed'; source: RunSource; reply: string; trace: TraceCall[]; ms: number; unsupported?: boolean }
  | { status: 'failed'; source: RunSource; error: string; httpStatus?: number; ms: number }
  | { status: 'cancelled'; source: RunSource; ms: number };
export type Health =
  | { state: 'disconnected'; detail: string }
  | { state: 'no-key'; model: string }
  | { state: 'key-configured'; model: string };

export type ScanFinding = { sev: 'critical' | 'high' | 'medium' | 'low'; title: string; why: string; rule: string; count: number; sample: string };
export type ScanReport = { engine: string; target: string; findings: ScanFinding[]; score: number | null };

export interface LabTransport {
  readonly source: RunSource;
  health(signal?: AbortSignal): Promise<Health>;
  chat(request: ChatRequest, signal: AbortSignal): Promise<ChatResult>;
  scan?(signal?: AbortSignal): Promise<ScanReport>;
}

// GET /api/scan (server.py 8bde0d2): {engine, target, findings:[{sev,title,why,rule,count,sample}], score}.
// It reads an existing report file; an empty list can also mean "no report", never "clean".
export function parseScan(value: unknown): ScanReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Scan response was not a JSON object.');
  const r = value as Record<string, unknown>;
  if (typeof r.engine !== 'string' || typeof r.target !== 'string' || !Array.isArray(r.findings)) throw new Error('Unexpected scan response shape.');
  const sevs = ['critical', 'high', 'medium', 'low'];
  const findings = r.findings.slice(0, 40).map(f => {
    const x = (f ?? {}) as Record<string, unknown>;
    if (typeof x.sev !== 'string' || !sevs.includes(x.sev) || typeof x.title !== 'string') throw new Error('Scan finding is malformed.');
    return { sev: x.sev as ScanFinding['sev'], title: x.title.slice(0, 200), why: text(x.why, 400), rule: text(x.rule, 120), count: typeof x.count === 'number' && Number.isFinite(x.count) ? Math.max(0, Math.round(x.count)) : 0, sample: text(x.sample, 200) };
  });
  const score = typeof r.score === 'number' && Number.isFinite(r.score) ? Math.min(10, Math.max(0, r.score)) : null;
  return { engine: r.engine.slice(0, 60), target: r.target.slice(0, 120), findings, score };
}

export function validateRequest(request: ChatRequest): string | null {
  if (request.system.length > LIMITS.system) return `System rules must be ${LIMITS.system} characters or fewer.`;
  if (request.messages.length !== 1 || request.messages[0].role !== 'user') return 'Each lab run sends exactly one fresh user message.';
  const content = request.messages[0].content;
  if (!content.trim() || content.length > LIMITS.message) return `Message must contain 1 to ${LIMITS.message} characters.`;
  if (request.tools.length > LIMITS.tools) return `Use at most ${LIMITS.tools} tools.`;
  for (const tool of request.tools) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) return 'Tool names use letters, numbers, _ or - (max 64).';
    if (tool.description.length > LIMITS.toolField || tool.returns.length > LIMITS.toolField) return `Tool text must be ${LIMITS.toolField} characters or fewer.`;
  }
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > LIMITS.requestBytes) return 'Request is too large.';
  return null;
}

export function sanitizeError(text: unknown): string {
  const raw = typeof text === 'string' ? text : 'Unknown error';
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(api[_-]?key|token|secret|authorization)(["'\s:=]+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1$2[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 240) || 'Unknown error';
}

const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : value == null ? '' : JSON.stringify(value).slice(0, max);

export function parseChatResponse(value: unknown): { reply: string; trace: TraceCall[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Response was not a JSON object.');
  const record = value as Record<string, unknown>;
  if (typeof record.error === 'string') throw new Error(sanitizeError(record.error));
  if (typeof record.reply !== 'string') throw new Error('Response has no reply text.');
  if (!Array.isArray(record.trace)) throw new Error('Response has no trace array.');
  const trace = record.trace.slice(0, LIMITS.traceCalls).map(call => {
    if (!call || typeof call !== 'object' || typeof (call as TraceCall).tool !== 'string') throw new Error('Trace entry is malformed.');
    const c = call as Record<string, unknown>;
    return { tool: text(c.tool, 64), args: text(c.args, LIMITS.toolField), returns: text(c.returns, LIMITS.toolField) };
  });
  return { reply: record.reply.slice(0, LIMITS.reply), trace };
}

export function parseHealth(value: unknown): Health {
  if (!value || typeof value !== 'object') return { state: 'disconnected', detail: 'Health response was not JSON.' };
  const { ok, model } = value as Record<string, unknown>;
  if (typeof ok !== 'boolean' || typeof model !== 'string') return { state: 'disconnected', detail: 'Unexpected health response shape.' };
  return ok ? { state: 'key-configured', model: model.slice(0, 80) } : { state: 'no-key', model: model.slice(0, 80) };
}

async function readBoundedJSON(response: Response): Promise<unknown> {
  const body = await response.text();
  if (body.length > LIMITS.responseBytes) throw new Error('Response is too large.');
  try { return JSON.parse(body); } catch { throw new Error(`Server answered HTTP ${response.status} without JSON.`); }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createHttpTransport(fetchImpl: FetchLike = (input, init) => fetch(input, init), options: { timeoutMs?: number; now?: () => number } = {}): LabTransport {
  const timeoutMs = options.timeoutMs ?? LIMITS.timeoutMs;
  const now = options.now ?? (() => performance.now());
  return {
    source: 'live',
    async health(signal) {
      try {
        const response = await fetchImpl(`${LAB_API_BASE}/health`, { method: 'GET', signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!response.ok) return { state: 'disconnected', detail: `Health check answered HTTP ${response.status}.` };
        return parseHealth(await readBoundedJSON(response));
      } catch (error) {
        return { state: 'disconnected', detail: sanitizeError(error instanceof Error ? error.message : String(error)) };
      }
    },
    async scan(signal) {
      const response = await fetchImpl(`${LAB_API_BASE}/scan`, { method: 'GET', signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Scan report answered HTTP ${response.status}.`);
      return parseScan(await readBoundedJSON(response));
    },
    async chat(request, signal) {
      const started = now();
      const invalid = validateRequest(request);
      if (invalid) return { status: 'failed', source: 'live', error: invalid, ms: 0 };
      if (signal.aborted) return { status: 'cancelled', source: 'live', ms: 0 };
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), timeoutMs);
      const relay = () => timeout.abort();
      signal.addEventListener('abort', relay, { once: true });
      let httpStatus: number | undefined;
      try {
        const response = await fetchImpl(`${LAB_API_BASE}/chat`, { method: 'POST', signal: timeout.signal, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(request) });
        httpStatus = response.status;
        const json = await readBoundedJSON(response);
        const parsed = parseChatResponse(json);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { status: 'completed', source: 'live', ...parsed, ms: Math.round(now() - started) };
      } catch (error) {
        const ms = Math.round(now() - started);
        if (signal.aborted) return { status: 'cancelled', source: 'live', ms };
        if (timeout.signal.aborted) return { status: 'failed', source: 'live', error: `No answer within ${Math.round(timeoutMs / 1000)} s. The run was stopped.`, ms };
        return { status: 'failed', source: 'live', error: sanitizeError(error instanceof Error ? error.message : String(error)), httpStatus, ms };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', relay);
      }
    },
  };
}
