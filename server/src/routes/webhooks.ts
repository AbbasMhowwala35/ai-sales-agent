import { Router, type Request } from 'express';
import express from 'express';
import { Call } from '../models/index.js';
import { env } from '../config/env.js';
import { twiml, validateTwilioSignature } from '../providers/telephony/twilio.js';
import { beginConversation, conversationTurn, finalizeCall, loadCallContext, addToDnc } from '../services/calls/lifecycle.js';
import { retrieve, extractiveAnswer } from '../services/knowledge/retrieve.js';
import { parseMeetingTime } from '../services/agent/nlu.js';
import { createAppointment } from '../services/calls/appointments.js';
import { timingSafeEqualStr } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { forbidden } from '../lib/errors.js';
import { cachedTts, elevenEnabled } from '../providers/voice/elevenlabs.js';
import { storage } from '../providers/storage/index.js';

export const webhooksRouter = Router();
webhooksRouter.use(express.urlencoded({ extended: false, limit: '200kb' }));

function verifyTwilio(req: Request) {
  if (!env.TWILIO_VALIDATE_SIGNATURE) return;
  const url = `${env.PUBLIC_BASE_URL}${req.originalUrl}`;
  if (!validateTwilioSignature(url, req.body ?? {}, req.header('x-twilio-signature'))) throw forbidden('Invalid Twilio signature');
}

async function callFor(req: Request) {
  const call = await Call.findOne({ _id: req.params.callId }).setOptions({ crossTenant: true }).lean();
  return call ? { call, businessId: String(call.businessId) } : null;
}

const voiceOpts = (agent: any) => ({ voice: agent?.voice?.startsWith('Polly.') || agent?.voice?.startsWith('Google.') ? agent.voice : 'Polly.Joanna-Neural', language: agent?.language ?? 'en-US' });

/** Natural ElevenLabs audio for Twilio (<Play>), falling back to Twilio TTS if synthesis fails. */
async function voiceFor(agent: any, businessId: string, text: string) {
  const base = voiceOpts(agent);
  if (agent?.voiceProvider !== 'elevenlabs' || !agent?.elevenVoiceId || !elevenEnabled()) return base;
  try {
    const { hash } = await cachedTts(businessId, text, agent.elevenVoiceId, agent.speakingRate ?? 1);
    return { ...base, playUrl: `${env.PUBLIC_BASE_URL}/api/webhooks/tts/${businessId}/${hash}.mp3` };
  } catch (e: any) { logger.warn({ err: e.message }, 'elevenlabs tts failed, using <Say>'); return base; }
}

/** Serves synthesized agent speech to Twilio. Paths are content hashes (unguessable); content is the agent’s own lines. */
webhooksRouter.get('/tts/:bid/:hash.mp3', async (req, res) => {
  const { bid, hash } = req.params as any;
  if (!/^[a-f0-9]{24}$/.test(bid) || !/^[a-f0-9]{64}$/.test(hash)) return res.status(404).end();
  const key = `${bid}/tts/${hash}.mp3`;
  if (!storage.exists(key)) return res.status(404).end();
  res.setHeader('content-type', 'audio/mpeg');
  res.setHeader('cache-control', 'public, max-age=86400');
  storage.stream(key).pipe(res);
});

/* ------------------------------- Twilio ------------------------------- */
webhooksRouter.post('/twilio/voice/:callId', async (req, res) => {
  verifyTwilio(req);
  res.type('text/xml');
  const c = await callFor(req);
  if (!c) return res.send(twiml.hangup());
  if (req.body.AnsweredBy && /machine|fax/.test(req.body.AnsweredBy)) {
    await finalizeCall(String(c.call._id), c.businessId, { result: 'voicemail', endReason: 'Voicemail / answering machine detected' });
    return res.send(twiml.hangup());
  }
  const r = await beginConversation(String(c.call._id), c.businessId);
  if (!r) return res.send(twiml.hangup());
  res.send(twiml.sayGather(r.reply, { ...(await voiceFor(r.agent, c.businessId, r.reply)), action: `${env.PUBLIC_BASE_URL}/api/webhooks/twilio/gather/${c.call._id}` }));
});

webhooksRouter.post('/twilio/gather/:callId', async (req, res) => {
  verifyTwilio(req);
  res.type('text/xml');
  const c = await callFor(req);
  if (!c || c.call.status === 'ended') return res.send(twiml.hangup());
  const speech = String(req.body.SpeechResult ?? '').slice(0, 1000);
  const r = await conversationTurn(String(c.call._id), c.businessId, speech);
  if (!r) return res.send(twiml.hangup());
  const v = await voiceFor(r.agent, c.businessId, r.reply);
  const transfer = r.actions.find((a) => a.type === 'transfer') as any;
  if (transfer) return res.send(twiml.sayDial(r.reply, transfer.number, { ...v, callerId: env.TWILIO_FROM_NUMBER }));
  if (r.end) return res.send(twiml.sayHangup(r.reply, v));
  res.send(twiml.sayGather(r.reply, { ...v, action: `${env.PUBLIC_BASE_URL}/api/webhooks/twilio/gather/${c.call._id}` }));
});

webhooksRouter.post('/twilio/status/:callId', async (req, res) => {
  verifyTwilio(req);
  const c = await callFor(req);
  if (!c) return res.status(204).end();
  const status = String(req.body.CallStatus);
  const id = String(c.call._id);
  if (status === 'ringing' || status === 'initiated') await Call.updateOne({ businessId: c.businessId, _id: id, status: { $in: ['queued', 'ringing'] } }, { status: 'ringing' });
  else if (status === 'in-progress') await Call.updateOne({ businessId: c.businessId, _id: id }, { status: 'in_progress', answeredAt: new Date() });
  else {
    const map: Record<string, any> = { completed: 'answered', busy: 'busy', 'no-answer': 'missed', failed: 'failed', canceled: 'failed' };
    await finalizeCall(id, c.businessId, { result: map[status] ?? 'failed', durationSec: Number(req.body.CallDuration ?? 0) || undefined, endReason: req.body.SipResponseCode ? `SIP ${req.body.SipResponseCode}` : status });
  }
  res.status(204).end();
});

webhooksRouter.post('/twilio/recording/:callId', async (req, res) => {
  verifyTwilio(req);
  const c = await callFor(req);
  if (c && req.body.RecordingStatus === 'completed' && req.body.RecordingUrl) {
    await finalizeCall(String(c.call._id), c.businessId, { result: 'answered', recordingUrl: String(req.body.RecordingUrl) });
  }
  res.status(204).end();
});

/* ------------------------------- Telnyx -------------------------------- */
// TeXML is TwiML-compatible; differences: numeric speechTimeout, no Twilio-only Gather attributes, JSON or form bodies.
const texml = {
  sayGather(text: string, o: any) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" speechTimeout="2" timeout="8" language="${xmlEsc(o.language)}" action="${xmlEsc(o.action)}">${speakTexml(text, o)}</Gather><Redirect method="POST">${xmlEsc(o.action)}</Redirect></Response>`;
  },
  sayHangup(text: string, o: any) { return `<?xml version="1.0" encoding="UTF-8"?><Response>${speakTexml(text, o)}<Hangup/></Response>`; },
  sayDial(text: string, number: string, o: any) { return `<?xml version="1.0" encoding="UTF-8"?><Response>${speakTexml(text, o)}<Dial${o.callerId ? ` callerId="${xmlEsc(o.callerId)}"` : ''} timeout="25">${xmlEsc(number)}</Dial></Response>`; },
  hangup() { return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`; },
};
const xmlEsc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const speakTexml = (text: string, o: any) => (o.playUrl ? `<Play>${xmlEsc(o.playUrl)}</Play>` : `<Say voice="${xmlEsc(o.voice)}" language="${xmlEsc(o.language)}">${xmlEsc(text)}</Say>`);

async function telnyxCall(req: Request) {
  const { verifyTelnyxKey } = await import('../providers/telephony/telnyx.js');
  if (!verifyTelnyxKey(String(req.params.callId), req.query.k)) throw forbidden('Invalid webhook key');
  const c = await callFor(req);
  // Telnyx's create-call response has no id; remember the CallSid from the first webhook (needed to hang up).
  const sid = req.body?.CallSid ?? req.body?.call_sid;
  if (c && sid && !c.call.providerCallId) await Call.updateOne({ businessId: c.businessId, _id: c.call._id }, { providerCallId: String(sid) });
  return c;
}

webhooksRouter.post('/telnyx/voice/:callId', express.json({ limit: '200kb' }), async (req, res) => {
  const { telnyxHook } = await import('../providers/telephony/telnyx.js');
  const c = await telnyxCall(req);
  res.type('text/xml');
  if (!c) return res.send(texml.hangup());
  const r = await beginConversation(String(c.call._id), c.businessId);
  if (!r) return res.send(texml.hangup());
  res.send(texml.sayGather(r.reply, { ...(await voiceFor(r.agent, c.businessId, r.reply)), action: telnyxHook('gather', String(c.call._id)) }));
});

webhooksRouter.post('/telnyx/gather/:callId', express.json({ limit: '200kb' }), async (req, res) => {
  const { telnyxHook, speechFrom } = await import('../providers/telephony/telnyx.js');
  const c = await telnyxCall(req);
  res.type('text/xml');
  if (!c || c.call.status === 'ended') return res.send(texml.hangup());
  const r = await conversationTurn(String(c.call._id), c.businessId, speechFrom(req.body));
  if (!r) return res.send(texml.hangup());
  const v = await voiceFor(r.agent, c.businessId, r.reply);
  const transfer = r.actions.find((a) => a.type === 'transfer') as any;
  if (transfer) return res.send(texml.sayDial(r.reply, transfer.number, { ...v, callerId: env.TELNYX_FROM_NUMBER }));
  if (r.end) return res.send(texml.sayHangup(r.reply, v));
  res.send(texml.sayGather(r.reply, { ...v, action: telnyxHook('gather', String(c.call._id)) }));
});

webhooksRouter.post('/telnyx/status/:callId', express.json({ limit: '200kb' }), async (req, res) => {
  const c = await telnyxCall(req);
  if (!c) return res.status(204).end();
  const status = String(req.body?.CallStatus ?? req.body?.call_status ?? '').toLowerCase();
  const id = String(c.call._id);
  if (status === 'ringing' || status === 'initiated' || status === 'queued') await Call.updateOne({ businessId: c.businessId, _id: id, status: { $in: ['queued', 'ringing'] } }, { status: 'ringing' });
  else if (status === 'in-progress' || status === 'answered') await Call.updateOne({ businessId: c.businessId, _id: id }, { status: 'in_progress', answeredAt: new Date() });
  else if (status) {
    const map: Record<string, any> = { completed: 'answered', busy: 'busy', 'no-answer': 'missed', no_answer: 'missed', failed: 'failed', canceled: 'failed' };
    await finalizeCall(id, c.businessId, { result: map[status] ?? 'failed', durationSec: Number(req.body?.CallDuration ?? req.body?.Duration ?? 0) || undefined, endReason: status });
  }
  res.status(204).end();
});

/* -------------------------------- Vapi -------------------------------- */
webhooksRouter.post('/vapi', express.json({ limit: '5mb' }), async (req, res) => {
  if (env.VAPI_WEBHOOK_SECRET) {
    const got = req.header('x-vapi-secret') ?? '';
    if (!timingSafeEqualStr(got, env.VAPI_WEBHOOK_SECRET)) throw forbidden('Invalid Vapi secret');
  }
  const msg = req.body?.message ?? {};
  const meta = msg.call?.assistant?.metadata ?? msg.call?.metadata ?? msg.assistant?.metadata ?? {};
  const callId = meta.callId as string | undefined;
  if (!callId) return res.json({});
  const ctx = await loadCallContext(callId);
  if (!ctx) return res.json({});
  const businessId = String(ctx.call.businessId);

  if (msg.type === 'status-update') {
    if (msg.status === 'ringing') await Call.updateOne({ businessId, _id: callId }, { status: 'ringing' });
    if (msg.status === 'in-progress') await Call.updateOne({ businessId, _id: callId }, { status: 'in_progress', answeredAt: new Date() });
    return res.json({});
  }

  if (msg.type === 'tool-calls') {
    const results: { toolCallId: string; result: string }[] = [];
    for (const tc of msg.toolCallList ?? msg.toolCalls ?? []) {
      const name = tc.function?.name ?? tc.name;
      let args = tc.function?.arguments ?? tc.arguments ?? {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      let result = 'ok';
      try {
        if (name === 'search_knowledge_base') {
          const chunks = await retrieve(businessId, String(args.query ?? ''), 3);
          result = chunks.length ? extractiveAnswer(String(args.query), chunks, 3) || chunks.map((c) => c.text.slice(0, 400)).join('\n') : 'No information found. Offer to have a specialist follow up.';
        } else if (name === 'book_meeting' && ctx.lead) {
          const at = parseMeetingTime(String(args.time_text ?? ''), ctx.business?.compliance?.timezone);
          if (!at) result = 'Could not understand the time. Ask for a specific day and time.';
          else {
            const appt = await createAppointment({ businessId, leadId: ctx.lead._id, callId, at, kind: args.kind === 'callback' ? 'callback' : 'meeting', business: ctx.business, lead: ctx.lead });
            await Call.updateOne({ businessId, _id: callId }, { appointmentId: appt._id, 'state.slots.meetingAt': at.toISOString(), 'state.slots.meetingKind': args.kind ?? 'meeting' });
            result = `Booked for ${at.toISOString()}. Confirm the time back to the prospect.`;
          }
        } else if (name === 'mark_do_not_call' && ctx.lead) {
          await addToDnc(businessId, ctx.lead, 'opt_out', `Requested during Vapi call ${callId}`);
          await Call.updateOne({ businessId, _id: callId }, { optOut: true });
          result = 'Number removed. Apologise briefly and end the call.';
        }
      } catch (e: any) { logger.warn({ e: e.message, name }, 'vapi tool failed'); result = 'Tool error — continue the conversation without it.'; }
      results.push({ toolCallId: tc.id, result });
    }
    return res.json({ results });
  }

  if (msg.type === 'end-of-call-report') {
    const reason = String(msg.endedReason ?? '');
    const result = /no-answer|customer-did-not-answer/.test(reason) ? 'missed' : /busy/.test(reason) ? 'busy' : /voicemail/.test(reason) ? 'voicemail' : /error|failed|invalid/.test(reason) ? 'failed' : 'answered';
    const msgs = msg.artifact?.messages ?? msg.messages ?? [];
    const t0 = msgs[0]?.time ?? 0;
    const segments = msgs.filter((m: any) => ['bot', 'assistant', 'user'].includes(m.role) && m.message).map((m: any) => ({
      speaker: m.role === 'user' ? 'customer' : 'agent', text: m.message,
      start: m.secondsFromStart ?? (m.time - t0) / 1000, end: (m.secondsFromStart ?? (m.time - t0) / 1000) + (m.duration ?? 0) / 1000,
    }));
    await finalizeCall(callId, businessId, {
      result, endReason: reason, segments,
      durationSec: Math.round(msg.durationSeconds ?? msg.call?.duration ?? 0) || undefined,
      recordingUrl: msg.artifact?.recordingUrl ?? msg.recordingUrl ?? msg.artifact?.recording?.mono?.combinedUrl,
      summary: msg.analysis?.summary ?? msg.summary,
    });
    return res.json({});
  }
  res.json({});
});
