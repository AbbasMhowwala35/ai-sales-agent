import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

/** Fetch hook with loading / error / reload and optional polling. */
export function useApi<T = any>(path: string | null, opts: { poll?: number; deps?: unknown[] } = {}) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(!!path);
  const first = useRef(true);
  const load = useCallback(async (silent = false) => {
    if (!path) return;
    const ctrl = new AbortController();
    if (!silent) setLoading(true);
    try { setData(await get<T>(path, ctrl.signal)); setError(undefined); }
    catch (e: any) { if (e?.name !== 'AbortError') setError(e.message); }
    finally { setLoading(false); }
    return () => ctrl.abort();
  }, [path]);
  useEffect(() => { void load(!first.current && data !== undefined); first.current = false; /* eslint-disable-next-line */ }, [load, ...(opts.deps ?? [])]);
  useEffect(() => {
    if (!opts.poll || !path) return;
    const t = setInterval(() => void load(true), opts.poll);
    return () => clearInterval(t);
  }, [opts.poll, load, path]);
  return { data, error, loading, reload: () => load(true), setData };
}
