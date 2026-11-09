import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { fetchWithRetry, jsonOrThrow } from '../http.js';
import { logger } from '../../lib/logger.js';
import type { TelephonyProvider, DialRequest } from './types.js';

/**
 * Telnyx Programmable Voice via TeXML (Telnyx's TwiML-compatible markup). Chosen for the beta because its free
 * trial ($5 credit) allows calls driven by your own webhooks — Twilio trials only allow Twilio's demo scripts.
 *
 * Conversation loop (same engine as Twilio):
 *   /webhooks/telnyx/voice/:callId?k=…  → <Say>/<Play> opener inside <Gather input="speech">
 *   /webhooks/telnyx/gather/:callId?k=… → recognised speech → AI engine → reply + <Gather> | <Dial> | <Hangup>
 * Webhook URLs carry a per-call HMAC key (k), so only the URLs we hand to Telnyx are accepted.
 */
const API = 'https://api.telnyx.com/v2';

export const telnyxConfigured = () => !!(env.TELNYX_API_KEY && env.TELNYX_ACCOUNT_SID && env.TELNYX_APP_ID);

/** Per-call webhook key: HMAC(callId) — unguessable, verifiable without any provider-specific signature scheme. */
export function telnyxKey(callId: string) {
  return crypto.createHmac('sha256', `telnyx-webhook:${env.ENCRYPTION_KEY}`).update(callId).digest('hex').slice(0, 32);
}
export function verifyTelnyxKey(callId: string, k: unknown) {
  const want = Buffer.from(telnyxKey(callId)); const got = Buffer.from(String(k ?? ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
export const telnyxHook = (kind: 'voice' | 'gather' | 'status', callId: string) => `${env.PUBLIC_BASE_URL}/api/webhooks/telnyx/${kind}/${callId}?k=${telnyxKey(callId)}`;

async function telnyxApi(path: string, body: Record<string, unknown>) {
  const res = await fetchWithRetry(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TELNYX_API_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  }, 1);
  return jsonOrThrow(res, 'Telnyx');
}

export const telnyx: TelephonyProvider = {
  id: 'telnyx',
  async dial(req: DialRequest) {
    const from = req.from ?? env.TELNYX_FROM_NUMBER;
    if (!from) throw new Error('No caller number: set TELNYX_FROM_NUMBER to your Telnyx number');
    const body: Record<string, unknown> = {
      To: req.to,
      From: from,
      ApplicationSid: env.TELNYX_APP_ID,
      Url: telnyxHook('voice', req.callId),
      UrlMethod: 'POST',
      StatusCallback: telnyxHook('status', req.callId),
      StatusCallbackMethod: 'POST',
      StatusCallbackEvent: 'initiated ringing answered completed',
      Timeout: 25,
      TimeLimit: 900,
    };
    if (req.record && env.TELNYX_RECORD) Object.assign(body, { Record: true, RecordingChannels: 'dual' });
    const data = await telnyxApi(`/texml/Accounts/${env.TELNYX_ACCOUNT_SID}/Calls`, body);
    // The create response may not include a call id; the first webhook carries CallSid and we store it then.
    const sid = data?.sid ?? data?.call_sid ?? data?.CallSid ?? data?.data?.call_sid;
    logger.info({ callId: req.callId, status: data?.status }, 'telnyx call requested');
    return { providerCallId: sid ? String(sid) : '' };
  },
  async hangup(sid: string) {
    if (!sid) return;
    await telnyxApi(`/texml/Accounts/${env.TELNYX_ACCOUNT_SID}/Calls/${sid}`, { Status: 'completed' }).catch(() => undefined);
  },
};

/** Recognised speech, whatever the field is called in Telnyx's callback (TwiML-compatible first). */
export function speechFrom(body: any) {
  return String(body?.SpeechResult ?? body?.Speech ?? body?.speech ?? body?.SpeechResults ?? body?.Transcript ?? body?.TranscriptionText ?? body?.Digits ?? '').slice(0, 1000);
}
