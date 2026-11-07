import crypto from 'node:crypto';
import { env } from '../config/env.js';

/** AES-256-GCM field encryption. Output format: enc:v1:<iv>:<tag>:<ciphertext> (base64). */
const key = crypto.createHash('sha256').update(env.ENCRYPTION_KEY).digest();
const hmacKey = crypto.createHash('sha256').update('blind-index:' + env.ENCRYPTION_KEY).digest();
const PREFIX = 'enc:v1:';

export function encrypt(plain: string | null | undefined): string | null | undefined {
  if (plain === null || plain === undefined || plain === '') return plain;
  if (typeof plain === 'string' && plain.startsWith(PREFIX)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(value: string | null | undefined): string | null | undefined {
  if (!value || typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  try {
    const [ivB, tagB, ctB] = value.slice(PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Deterministic keyed hash so encrypted values can still be looked up / de-duplicated. */
export function blindIndex(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return crypto.createHmac('sha256', hmacKey).update(value.trim().toLowerCase()).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function timingSafeEqualStr(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
