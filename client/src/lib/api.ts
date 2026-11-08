import { useAuth } from '../store/auth';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: any) { super(message); }
}

const BASE = import.meta.env.VITE_API_URL ?? '';

/*
 * Free hosting sleeps when idle; the first requests after that fail (502/503) or hang while it wakes.
 * Instead of every request retrying on its own (which floods a waking server), ONE shared health check
 * waits for the server; requests that failed wait on it and then try exactly once more.
 */
let waking = false;
function setWaking(on: boolean) { if (waking !== on) { waking = on; window.dispatchEvent(new CustomEvent('server-waking', { detail: on })); } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let wakeGate: Promise<boolean> | null = null;
function waitForServer(): Promise<boolean> {
  if (!wakeGate) {
    wakeGate = (async () => {
      setWaking(true);
      try {
        for (const d of [1500, 3000, 5000, 8000, 10000, 12000, 15000]) {
          await sleep(d);
          try { const r = await fetch(`${BASE}/api/health`, { cache: 'no-store' }); if (r.ok) return true; } catch { /* still asleep */ }
        }
        return false;
      } finally { setWaking(false); wakeGate = null; }
    })();
  }
  return wakeGate;
}
const wakeable = (e: any) => e instanceof ApiError && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504 || e.code === 'NOT_JSON');

export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData; signal?: AbortSignal; raw?: boolean } = {}): Promise<T> {
  const method = opts.method ?? (opts.body || opts.form ? 'POST' : 'GET');
  if (method !== 'GET') {
    const out = await request<T>(path, opts);
    window.dispatchEvent(new Event('api-mutated')); // saved something → remembered GET answers are stale
    return out;
  }
  if (wakeGate) await wakeGate; // server is waking: queue behind the shared check instead of piling on
  try { return await request<T>(path, opts); } catch (e: any) {
    if (!wakeable(e) || opts.signal?.aborted) throw e;
    if (!(await waitForServer())) throw e;
    return request<T>(path, opts);
  }
}

async function request<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData; signal?: AbortSignal; raw?: boolean } = {}): Promise<T> {
  const token = useAuth.getState().token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'), headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined), signal: opts.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'Can’t reach the server. Check your connection and try again.');
  }
  if (res.status === 401 && token) { useAuth.getState().logout(); }
  if (opts.raw) return res as any;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : undefined; } catch { throw new ApiError(res.status, res.status >= 500 ? 'The server is starting up — try again in a moment.' : `Unexpected response (${res.status})`, 'NOT_JSON'); }
  if (!res.ok) {
    const err = data?.error ?? {};
    const details = Array.isArray(err.details) ? err.details.map((d: any) => d.message).filter(Boolean).slice(0, 3).join('; ') : '';
    throw new ApiError(res.status, err.message === 'Validation failed' && details ? details : err.message ?? `Request failed (${res.status})`, err.code, err.details);
  }
  return data as T;
}

export const get = <T = any>(p: string, signal?: AbortSignal) => api<T>(p, { signal });
export const post = <T = any>(p: string, body?: any) => api<T>(p, { method: 'POST', body: body ?? {} });
export const patch = <T = any>(p: string, body?: any) => api<T>(p, { method: 'PATCH', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
export const upload = <T = any>(p: string, form: FormData) => api<T>(p, { method: 'POST', form });

export const qs = (o: Record<string, any>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) p.set(k, Array.isArray(v) ? v.join(',') : String(v)); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Download an authenticated file (e.g. a PDF report) and save it in the browser. */
export async function download(path: string, filename: string) {
  const res: Response = await api(path, { raw: true });
  if (!res.ok) {
    let msg = 'Download failed';
    try { msg = (await res.json()).error?.message ?? msg; } catch { /* */ }
    throw new ApiError(res.status, msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
