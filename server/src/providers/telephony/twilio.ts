import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { fetchWithRetry, jsonOrThrow } from '../http.js';
import type { TelephonyProvider, DialRequest } from './types.js';

const base = () => `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`;
const auth = () => 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');

export async function twilioApi(path: string, params: Record<string, string>) {
  const res = await fetchWithRetry(`${base()}${path}`, {
    method: 'POST',
    headers: { authorization: auth(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return jsonOrThrow(res, 'Twilio');
}

/**
 * Twilio Programmable Voice. Conversation runs as a turn loop:
 *   /webhooks/twilio/voice/:callId  → <Say> opening + <Gather input="speech">
 *   /webhooks/twilio/gather/:callId → SpeechResult → AI engine → <Say> reply + <Gather> | <Dial> | <Hangup>
 * Twilio performs STT (Gather speech) and TTS (<Say> with Amazon Polly / Google voices).
 */
export const twilio: TelephonyProvider = {
  id: 'twilio',
  async dial(req: DialRequest) {
    const hook = `${env.PUBLIC_BASE_URL}/api/webhooks/twilio`;
    const params: Record<string, string> = {
      To: req.to,
      From: req.from ?? env.TWILIO_FROM_NUMBER!,
      Url: `${hook}/voice/${req.callId}`,
      Method: 'POST',
      StatusCallback: `${hook}/status/${req.callId}`,
      StatusCallbackMethod: 'POST',
      MachineDetection: 'Enable',
      Timeout: '25',
    };
    ['initiated', 'ringing', 'answered', 'completed'].forEach((e, i) => (params[`StatusCallbackEvent[${i}]`] = e));
    // StatusCallbackEvent must be repeated param — URLSearchParams handles via append below
    const body = new URLSearchParams(Object.entries(params).filter(([k]) => !k.startsWith('StatusCallbackEvent')));
    ['initiated', 'ringing', 'answered', 'completed'].forEach((e) => body.append('StatusCallbackEvent', e));
    if (req.record && !req.business?.compliance?.requireConsentForRecording) {
      body.append('Record', 'true');
      body.append('RecordingChannels', 'dual');
      body.append('RecordingStatusCallback', `${hook}/recording/${req.callId}`);
    }
    const res = await fetchWithRetry(`${base()}/Calls.json`, { method: 'POST', headers: { authorization: auth(), 'content-type': 'application/x-www-form-urlencoded' }, body });
    const data = await jsonOrThrow(res, 'Twilio');
    return { providerCallId: data.sid };
  },
  async hangup(sid: string) {
    await twilioApi(`/Calls/${sid}.json`, { Status: 'completed' });
  },
};

/** Start recording mid-call (after the callee consents). */
export async function startTwilioRecording(sid: string, callId: string) {
  return twilioApi(`/Calls/${sid}/Recordings.json`, {
    RecordingStatusCallback: `${env.PUBLIC_BASE_URL}/api/webhooks/twilio/recording/${callId}`,
    RecordingChannels: 'dual',
  });
}

/** X-Twilio-Signature validation: base64(HMAC-SHA1(authToken, url + sorted(key+value))) */
export function validateTwilioSignature(url: string, params: Record<string, string>, signature?: string) {
  if (!env.TWILIO_AUTH_TOKEN || !signature) return false;
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', env.TWILIO_AUTH_TOKEN).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type VoiceOpts = { voice: string; language: string; playUrl?: string };
/** Speak via an ElevenLabs clip (<Play>) when available, else Twilio TTS (<Say>, Polly/Google neural voices). */
const speak = (text: string, o: VoiceOpts) => o.playUrl ? `<Play>${esc(o.playUrl)}</Play>` : `<Say voice="${esc(o.voice)}" language="${esc(o.language)}">${esc(text)}</Say>`;

export const twiml = {
  sayGather(text: string, opts: VoiceOpts & { action: string; hints?: string }) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" speechTimeout="auto" speechModel="phone_call" enhanced="true" language="${esc(opts.language)}" action="${esc(opts.action)}" method="POST" actionOnEmptyResult="true"${opts.hints ? ` hints="${esc(opts.hints)}"` : ''}>${speak(text, opts)}</Gather><Redirect method="POST">${esc(opts.action)}</Redirect></Response>`;
  },
  sayHangup(text: string, opts: VoiceOpts) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${speak(text, opts)}<Hangup/></Response>`;
  },
  sayDial(text: string, number: string, opts: VoiceOpts & { callerId?: string }) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${speak(text, opts)}<Dial${opts.callerId ? ` callerId="${esc(opts.callerId)}"` : ''} timeout="25">${esc(number)}</Dial></Response>`;
  },
  hangup() { return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`; },
};
