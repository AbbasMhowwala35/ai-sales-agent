import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

/*
 * Data hook built to keep requests to a minimum (the app runs on small free servers):
 *  - identical requests in flight at the same time share ONE network call
 *  - answers are remembered for `staleMs` (default 30s): revisiting a page shows them instantly, no refetch
 *  - polling only runs while the tab is visible; coming back to the tab refreshes stale data once
 *  - any save (POST/PATCH/DELETE) clears the memory, so you never see out-of-date data after a change
 */
type Entry = { data: unknown; at: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export function invalidateApiCache() { cache.clear(); }
if (typeof window !== 'undefined') window.addEventListener('api-mutated', invalidateApiCache);

function fetchShared<T>(path: string): Promise<T> {
  const running = inflight.get(path);
  if (running) return running as Promise<T>;
  const p = get<T>(path).then((d) => { cache.set(path, { data: d, at: Date.now() }); return d; }).finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

export function useApi<T = any>(path: string | null, opts: { poll?: number; deps?: unknown[]; staleMs?: number } = {}) {
  const staleMs = opts.staleMs ?? 30_000;
  const cached = path ? (cache.get(path) as Entry | undefined) : undefined;
  const [data, setData] = useState<T | undefined>(cached?.data as T | undefined);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(!!path && !cached);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (force = false) => {
    if (!path) return;
    const c = cache.get(path);
    if (!force && c && Date.now() - c.at < staleMs) { setData(c.data as T); setLoading(false); return; }
    if (!c) setLoading(true);
    try { const d = await fetchShared<T>(path); if (alive.current) { setData(d); setError(undefined); } }
    catch (e: any) { if (alive.current && e?.name !== 'AbortError') setError(e.message); }
    finally { if (alive.current) setLoading(false); }
  }, [path, staleMs]);

  // Path change (or explicit deps): show remembered data at once, fetch only if stale.
  useEffect(() => {
    const c = path ? cache.get(path) : undefined;
    setData(c?.data as T | undefined);
    setError(undefined);
    void load(false);
    /* eslint-disable-next-line */
  }, [load, ...(opts.deps ?? [])]);

  // Poll only while visible.
  useEffect(() => {
    if (!opts.poll || !path) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, opts.poll);
    return () => clearInterval(t);
  }, [opts.poll, load, path]);

  // Back to the tab: refresh once if what we have is stale.
  useEffect(() => {
    if (!path) return;
    const h = () => { if (document.visibilityState === 'visible') void load(false); };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [load, path]);

  return { data, error, loading, reload: () => load(true), setData };
}
