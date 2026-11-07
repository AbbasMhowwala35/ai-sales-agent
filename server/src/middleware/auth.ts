import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { TeamMember, type Role } from '../models/index.js';

export interface AuthContext { userId: string; businessId: string; role: Role; email: string; name: string }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: AuthContext; tenant?: { businessId: Types.ObjectId } }
  }
}

export function signToken(ctx: AuthContext) {
  return jwt.sign(ctx, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any, issuer: 'ai-sales-agent' });
}

/** Short-lived signed URL token for media (e.g. <audio src>) where headers can't be sent. */
export function signMediaToken(payload: { userId: string; businessId: string; callId: string; action: 'listen' | 'download' }) {
  return jwt.sign({ ...payload, typ: 'media' }, env.JWT_SECRET, { expiresIn: '15m', issuer: 'ai-sales-agent' });
}
export function verifyMediaToken(token: string) {
  let p: any;
  try { p = jwt.verify(token, env.JWT_SECRET, { issuer: 'ai-sales-agent' }); } catch { throw unauthorized('Media link expired or invalid'); }
  if (p.typ !== 'media') throw unauthorized('Invalid media token');
  return p as { userId: string; businessId: string; callId: string; action: 'listen' | 'download' };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) throw unauthorized();
  let payload: AuthContext;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { issuer: 'ai-sales-agent' }) as AuthContext;
  } catch {
    throw unauthorized('Session expired or invalid token');
  }
  if ((payload as any).typ === 'media') throw unauthorized();
  // Re-check membership on every request so revoked/disabled members lose access immediately.
  const member = await TeamMember.findOne({ businessId: payload.businessId, userId: payload.userId }).lean();
  // Unknown member (e.g. the demo database was reset) → 401 so the app signs out and shows the login page.
  if (!member) throw unauthorized('Your session has expired — please sign in again');
  if (member.status !== 'active') throw forbidden('Your access to this workspace has been revoked');
  req.auth = { ...payload, role: member.role as Role };
  req.tenant = { businessId: new Types.ObjectId(payload.businessId) };
  next();
}

/** Tenant filter helper — always spread into queries for tenant-scoped models. */
export const scope = (req: Request) => ({ businessId: req.tenant!.businessId });
