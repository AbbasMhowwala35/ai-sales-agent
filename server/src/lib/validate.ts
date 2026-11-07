import type { ZodType } from 'zod';
import { badRequest } from './errors.js';

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      'Validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export function pageParams(q: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(q.limit ?? '25'), 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
}
