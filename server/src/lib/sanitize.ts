import type { Request, Response, NextFunction } from 'express';

/** Strip keys starting with `$` or containing `.` to block NoSQL operator injection. Express 5 safe. */
export function stripOperators(value: unknown, depth = 0): unknown {
  if (depth > 20) return undefined;
  if (Array.isArray(value)) return value.map((v) => stripOperators(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor') continue;
      out[k] = stripOperators(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function sanitizeRequest(req: Request, _res: Response, next: NextFunction) {
  if (req.body) req.body = stripOperators(req.body);
  if (req.params) {
    for (const k of Object.keys(req.params)) {
      if (typeof req.params[k] !== 'string') delete req.params[k];
    }
  }
  // Express 5: req.query is a getter; sanitise in place.
  const q = req.query as Record<string, unknown>;
  for (const k of Object.keys(q)) {
    if (k.startsWith('$') || (q[k] && typeof q[k] === 'object')) delete q[k];
  }
  next();
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
