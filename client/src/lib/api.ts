import { useAuth } from '../store/auth';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: any) { super(message); }
}

const BASE = import.meta.env.VITE_API_URL ?? '';

export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData; signal?: AbortSignal; raw?: boolean } = {}): Promise<T> {
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
  const data = text ? JSON.parse(text) : undefined;
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
