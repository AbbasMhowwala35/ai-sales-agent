import { sleep } from '../lib/time.js';

/** fetch with timeout + retry on 429/5xx with exponential backoff (honours Retry-After). */
export async function fetchWithRetry(url: string, init: RequestInit & { timeoutMs?: number } = {}, retries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Request failed');
}

export async function jsonOrThrow(res: Response, provider: string) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${provider} API error ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** A billing / key problem (no credits, bad key) — retrying won't help, so callers fall back to built-in mode. */
export function isAccountError(e: unknown) {
  return /insufficient_quota|credit_balance|billing|invalid_api_key|incorrect api key|error 401|error 403|quota/i.test(String((e as any)?.message ?? e));
}
