import { Types } from 'mongoose';
import { Call, Lead, Business, AIAgent, Campaign, CampaignLead, CallTranscript, CallRecording, DncEntry } from '../../models/index.js';
import { getTelephony } from '../../providers/telephony/index.js';
import { canCall, resolveCallerId } from './compliance.js';
import { formatMeetingTime } from '../agent/nlu.js';
import { enqueue } from '../../queue/queue.js';
import { logActivity } from '../activity.js';
import { notify } from '../notifications.js';
import { blindIndex } from '../../lib/crypto.js';
import { maskPhone } from '../../lib/phone.js';
import { respond, start, type ConversationState, type EngineAction } from '../agent/engine.js';
import { createAppointment } from './appointments.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { clock } from '../../lib/clock.js';

export async function loadCallContext(callId: string, businessId?: string) {
  const call = await Call.findOne(businessId ? { businessId, _id: callId } : { _id: callId }).setOptions({ crossTenant: true }).select('+state');
  if (!call) return null;
  const bid = call.businessId;
  const [lead, business, agent, campaign] = await Promise.all([
    Lead.findOne({ businessId: bid, _id: call.leadId }),
    Business.findById(bid).lean(),
    call.agentId ? AIAgent.findOne({ businessId: bid, _id: call.agentId }).lean() : AIAgent.findOne({ businessId: bid, isDefault: true }).lean(),
    call.campaignId ? Campaign.findOne({ businessId: bid, _id: call.campaignId }).lean() : null,
  ]);
  return { call, lead, business, agent, campaign };
}

/** Create a call record and queue it for dialing. Compliance is checked here AND again right before dialing. */
export async function createAndQueueCall(opts: { businessId: unknown; leadId: unknown; agentId?: unknown; campaignId?: unknown; campaignLeadId?: unknown; attempt?: number; ignoreWindow?: boolean }) {
  const businessId = new Types.ObjectId(String(opts.businessId));
  const [lead, business] = await Promise.all([Lead.findOne({ businessId, _id: opts.leadId }), Business.findById(businessId).lean()]);
  if (!lead || !business) throw new Error('Lead not found');
  const campaign = opts.campaignId ? await Campaign.findOne({ businessId, _id: opts.campaignId }).lean() : null;
  const check = await canCall(lead, business, campaign, { ignoreWindow: opts.ignoreWindow });
  if (!check.ok) return { call: null, check };
  const agentId = opts.agentId ?? campaign?.agentId ?? (await AIAgent.findOne({ businessId, isDefault: true }, { _id: 1 }).lean())?._id;
  const call = await Call.create({
    businessId, leadId: lead._id, agentId, campaignId: opts.campaignId, campaignLeadId: opts.campaignLeadId,
    provider: env.TELEPHONY_PROVIDER, toNumber: lead.phone, fromNumber: resolveCallerId(business, lead).number, status: 'queued', attempt: opts.attempt ?? 1,
  });
  await enqueue('calls.dial', { callId: String(call._id), ignoreWindow: !!opts.ignoreWindow }, { businessId, uniqueKey: `dial:${call._id}`, maxAttempts: 2 });
  return { call, check };
}

export async function dialCall(callId: string, businessId: string, ignoreWindow = false) {
  const ctx = await loadCallContext(callId, businessId);
  if (!ctx || ctx.call.status !== 'queued') return;
  const { call, lead, business, agent, campaign } = ctx;
  if (!lead || !business) return finalizeCall(callId, businessId, { result: 'failed', endReason: 'Lead was deleted' });
  if (campaign && campaign.status !== 'active') return finalizeCall(callId, businessId, { result: 'failed', endReason: 'Campaign paused before dialing', noRetryCount: true });
  const provider = getTelephony();
  const check = await canCall(lead, business, campaign, { provider: provider.id, ignoreWindow });
  // the in-flight check would match this very call — exclude it
  if (!check.ok && !/already in progress/.test(check.reason ?? '')) return finalizeCall(callId, businessId, { result: 'failed', endReason: `Blocked by compliance: ${check.reason}`, noRetryCount: !!check.retryable, blocked: true });
  const record = business.compliance?.recordCalls !== false;
  try {
    call.status = 'ringing'; call.startedAt = new Date(); call.provider = provider.id;
    await call.save();
    const cid = resolveCallerId(business, lead);
    const { providerCallId } = await provider.dial({ callId, businessId, to: lead.phone!, from: cid.number, vapiPhoneNumberId: cid.vapiPhoneNumberId, agent, business, lead: lead.toJSON(), campaign, record });
    await Call.updateOne({ businessId, _id: callId }, { providerCallId });
  } catch (e: any) {
    logger.warn({ callId, err: e.message }, 'dial failed');
    await finalizeCall(callId, businessId, { result: 'failed', endReason: `Provider error: ${e.message?.slice(0, 200)}` });
  }
}

/** Begin a turn-based conversation (Twilio / simulator / test chat). */
export async function beginConversation(callId: string, businessId: string) {
  const ctx = await loadCallContext(callId, businessId);
  if (!ctx) return null;
  const { call, business, agent, lead, campaign } = ctx;
  const { reply, state } = start({ business, agent, lead: lead?.toJSON(), campaign });
  await Call.updateOne({ businessId, _id: callId }, { status: 'in_progress', answeredAt: call.answeredAt ?? new Date(), state });
  return { reply, agent };
}

export async function conversationTurn(callId: string, businessId: string, utterance: string) {
  const ctx = await loadCallContext(callId, businessId);
  if (!ctx) return null;
  const { call, business, agent, lead, campaign } = ctx;
  const state = (call.state as ConversationState) ?? start({ business, agent, lead: lead?.toJSON(), campaign }).state;
  const r = await respond({ business, agent, lead: lead?.toJSON(), campaign }, state, utterance);
  await Call.updateOne({ businessId, _id: callId }, { state: r.state, ...(r.state.optOut ? { optOut: true } : {}), ...(r.state.transfer ? { transferred: true } : {}), ...(r.state.recordingConsent !== undefined ? { recordingConsent: r.state.recordingConsent } : {}) });
  await applyActions(callId, businessId, r.actions, ctx);
  return { ...r, agent };
}

async function applyActions(callId: string, businessId: string, actions: EngineAction[], ctx: NonNullable<Awaited<ReturnType<typeof loadCallContext>>>) {
  for (const a of actions) {
    if (a.type === 'opt_out' && ctx.lead) await addToDnc(businessId, ctx.lead, 'opt_out', `Requested during call ${callId}`);
    if (a.type === 'nurture' && ctx.lead) {
      await setOutcome(businessId, ctx.lead._id, 'nurture', `Not now — follow up in ${a.label}`, a.at);
      await logActivity(businessId, ctx.lead._id, 'reminder', `Asked to be contacted again in ${a.label} (${a.at.toDateString()})`, { callId });
    }
    if (a.type === 'book' && ctx.lead) {
      const appt = await createAppointment({ businessId, leadId: ctx.lead._id, callId, at: a.at, kind: a.kind, business: ctx.business, lead: ctx.lead, with: a.with });
      await Call.updateOne({ businessId, _id: callId }, { appointmentId: appt._id });
    }
    if (a.type === 'recording_consent' && a.granted && ctx.call.provider === 'twilio' && ctx.call.providerCallId && ctx.business?.compliance?.recordCalls !== false && ctx.business?.compliance?.requireConsentForRecording) {
      const { startTwilioRecording } = await import('../../providers/telephony/twilio.js');
      await startTwilioRecording(ctx.call.providerCallId, callId).catch((e) => logger.warn({ e: e.message }, 'start recording failed'));
    }
  }
}

export async function addToDnc(businessId: unknown, lead: any, reason: 'opt_out' | 'manual' | 'complaint' | 'registry', source: string, userId?: unknown) {
  if (lead.phone) {
    await DncEntry.updateOne({ businessId, phoneHash: blindIndex(lead.phone) }, { $setOnInsert: { businessId, phoneHash: blindIndex(lead.phone), phoneMasked: maskPhone(lead.phone), reason, source, addedBy: userId } }, { upsert: true });
  }
  await Lead.updateOne({ businessId, _id: lead._id }, { doNotCall: true, consent: 'revoked' });
  await CampaignLead.updateMany({ businessId, leadId: lead._id, status: { $in: ['queued', 'retry'] } }, { status: 'skipped', skipReason: 'Opted out' });
  await logActivity(businessId, lead._id, 'opt_out', `Added to Do-Not-Call list (${reason})`, { source }, userId);
  if (reason === 'opt_out') await notify(businessId, { type: 'warning', title: 'Asked not to be called', message: `${lead.companyName ?? 'A prospect'} opted out — they’re on your Do-Not-Call list and won’t be called again.`, link: `/leads/${lead._id}` });
}

export interface FinalizeInput {
  result: 'answered' | 'missed' | 'busy' | 'failed' | 'voicemail';
  durationSec?: number;
  endReason?: string;
  segments?: { speaker: 'agent' | 'customer' | 'system'; text: string; start: number; end: number }[];
  recordingUrl?: string;
  summary?: string;
  noRetryCount?: boolean; // don't consume an attempt (e.g. paused / outside window)
  blocked?: boolean;
}

function segmentsFromState(state?: ConversationState, answeredAt?: Date) {
  if (!state?.messages?.length) return [];
  const t0 = answeredAt?.getTime() ?? state.messages[0].at;
  return state.messages.map((m, i) => {
    const start = Math.max(0, (m.at - t0) / 1000);
    const next = state.messages[i + 1]?.at;
    const est = m.content.split(/\s+/).length / 2.6; // ~155 wpm speech
    const end = next ? Math.min((next - t0) / 1000, start + est) : start + est;
    return { speaker: m.role === 'assistant' ? 'agent' as const : 'customer' as const, text: m.content, start: +start.toFixed(2), end: +Math.max(end, start + 0.5).toFixed(2) };
  });
}

/** Idempotent end-of-call processing: transcript, recording, lead + campaign state, retries, analysis. */
export async function finalizeCall(callId: string, businessId: string, input: FinalizeInput) {
  const ctx = await loadCallContext(callId, businessId);
  if (!ctx) return;
  const { call, lead, campaign } = ctx;
  if (call.status === 'ended' && call.result) {
    // late webhooks: allow enriching transcript/recording/duration only
    if (input.recordingUrl && !call.recordingId) await attachRecording(call, input.recordingUrl);
    return;
  }
  const endedAt = new Date();
  const duration = input.durationSec ?? (call.answeredAt ? Math.round((endedAt.getTime() - call.answeredAt.getTime()) / 1000) : 0);
  const result = input.result === 'answered' && duration === 0 && !call.answeredAt && !input.segments?.length ? 'missed' : input.result;
  call.set({ status: 'ended', result, endedAt, durationSec: duration, endReason: input.endReason ?? call.endReason, ...(input.summary ? { summary: input.summary } : {}) });

  const segments = input.segments?.length ? input.segments : segmentsFromState(call.state as ConversationState, call.answeredAt ?? undefined);
  if (segments.length) {
    const t = await CallTranscript.create({ businessId, callId: call._id, segments, fullText: segments.map((s) => `${s.speaker === 'agent' ? 'Agent' : 'Customer'}: ${s.text}`).join('\n'), language: ctx.agent?.language });
    call.transcriptId = t._id;
  }
  await call.save();
  if (input.recordingUrl) await attachRecording(call, input.recordingUrl);

  if (lead) {
    if (result === 'answered') {
      lead.lastContactedAt = endedAt;
      if (['new', 'qualified'].includes(lead.status)) lead.status = 'contacted';
      const st = call.state as ConversationState | undefined;
      if (st?.slots?.meetingAt && st.slots.meetingKind === 'meeting') lead.status = 'meeting_scheduled';
      else if (st?.slots?.interest === 'yes' && ['contacted', 'qualified', 'new'].includes(lead.status)) lead.status = 'interested';
      await lead.save();
    }
    await deriveOutcome(businessId, lead, call, result);
    await logActivity(businessId, lead._id, 'call', `${call.direction === 'test' ? 'Test call' : 'AI call'} ${result}${duration ? ` · ${Math.floor(duration / 60)}m ${duration % 60}s` : ''}${input.endReason ? ` · ${input.endReason}` : ''}`, { callId: String(call._id), result });
  }

  if (call.campaignLeadId && campaign) {
    const cl = await CampaignLead.findOne({ businessId, _id: call.campaignLeadId });
    if (cl) {
      if (input.noRetryCount) {
        cl.attempts = Math.max(0, cl.attempts - 1);
        cl.status = input.blocked && !/window|schedule|hours|progress|paused/i.test(input.endReason ?? '') ? 'skipped' : 'queued';
        if (cl.status === 'skipped') cl.skipReason = input.endReason;
        else cl.nextAttemptAt = new Date(clock.now().getTime() + 10 * 60_000);
      } else if (input.blocked) {
        cl.status = 'skipped'; cl.skipReason = input.endReason;
      } else if (result === 'answered' || call.optOut) {
        cl.status = 'completed'; // callbacks & "later" follow-ups are re-dialled by the follow-up dispatcher
      } else if (cl.attempts <= (campaign.maxRetries ?? 2)) {
        cl.status = 'retry'; cl.nextAttemptAt = new Date(clock.now().getTime() + (campaign.retryDelayMinutes ?? 120) * 60_000);
      } else cl.status = 'exhausted';
      cl.lastResult = result; cl.lastCallId = call._id;
      await cl.save();
    }
  }
  if (result === 'answered' && segments.length) await enqueue('calls.analyze', { callId: String(call._id) }, { businessId, uniqueKey: `analyze:${call._id}` });
  else await Call.updateOne({ businessId, _id: call._id }, { analysisStatus: 'skipped', nextAction: result === 'failed' ? 'Check the number / provider error and retry' : 'Retry the call at a different time' });
}

async function attachRecording(call: any, url: string) {
  const rec = await CallRecording.create({ businessId: call.businessId, callId: call._id, providerUrl: url, status: 'pending' });
  await Call.updateOne({ businessId: call.businessId, _id: call._id }, { recordingId: rec._id });
  await enqueue('recordings.download', { recordingId: String(rec._id) }, { businessId: call.businessId, maxAttempts: 5 });
}

export async function downloadRecording(recordingId: string, businessId: string) {
  const rec = await CallRecording.findOne({ businessId, _id: recordingId }); // not lean: decrypts providerUrl
  if (!rec || rec.status === 'available') return;
  const { storage } = await import('../../providers/storage/index.js');
  const { fetchWithRetry } = await import('../../providers/http.js');
  const url = rec.providerUrl as string;
  const isTwilio = /api\.twilio\.com/.test(url);
  const res = await fetchWithRetry(isTwilio && !/\.(mp3|wav)$/.test(url) ? `${url}.mp3` : url, {
    headers: isTwilio ? { authorization: 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64') } : {},
    timeoutMs: 120_000,
  });
  if (!res.ok) throw new Error(`Recording download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg';
  const ext = mime.includes('wav') ? 'wav' : 'mp3';
  const key = `${businessId}/recordings/${rec.callId}.${ext}`;
  await storage.put(key, buf);
  await CallRecording.updateOne({ businessId, _id: rec._id }, { status: 'available', storageKey: key, sizeBytes: buf.length, mimeType: mime });
}

/** Notify owners/admins + assignee about high-value outcomes. */
export async function notifyOutcome(businessId: unknown, lead: any, title: string, message: string) {
  const link = `/leads/${lead._id}`;
  if (lead.assignedTo) await notify(businessId, { userId: lead.assignedTo, type: 'success', title, message, link });
  else await notify(businessId, { type: 'success', title, message, link });
}

export type Outcome = 'none' | 'meeting' | 'interested' | 'callback' | 'nurture' | 'busy' | 'no_answer' | 'not_interested' | 'do_not_call';

export async function setOutcome(businessId: unknown, leadId: unknown, outcome: Outcome, note?: string, followUpAt?: Date | null) {
  const set: any = { outcome, outcomeNote: note, outcomeAt: clock.now() };
  if (followUpAt !== undefined) { set.followUpAt = followUpAt; set.nextFollowUpAt = followUpAt; set.followUpQueuedAt = null; }
  if (outcome === 'not_interested') set.status = 'lost';
  await Lead.updateOne({ businessId, _id: leadId }, set);
}

/** Turns a finished call into a clear “what the prospect wants” status for the CRM. */
async function deriveOutcome(businessId: string, lead: any, call: any, result: string) {
  const st = call.state as ConversationState | undefined;
  const tz = (await import('./compliance.js')).leadTimezone(lead, 'Asia/Kolkata');
  await Lead.updateOne({ businessId, _id: lead._id }, { lastAgentId: call.agentId, ...(call.campaignId ? { campaignId: call.campaignId } : {}) });
  if (call.optOut || st?.optOut) return setOutcome(businessId, lead._id, 'do_not_call', 'Asked not to be called', null);
  if (result !== 'answered') {
    if (['meeting', 'callback', 'nurture', 'interested'].includes(lead.outcome)) return; // keep the stronger signal
    return setOutcome(businessId, lead._id, result === 'busy' ? 'busy' : 'no_answer', result === 'busy' ? 'Line busy — retrying' : 'No answer — retrying');
  }
  const s = st?.slots;
  if (s?.meetingAt && s.meetingKind === 'meeting') return setOutcome(businessId, lead._id, 'meeting', `Meeting booked for ${formatMeetingTime(new Date(s.meetingAt), tz)}`, new Date(s.meetingAt));
  if (s?.meetingAt && s.meetingKind === 'callback') return setOutcome(businessId, lead._id, 'callback', `Wants a call back ${formatMeetingTime(new Date(s.meetingAt), tz)}`, new Date(s.meetingAt));
  if (s?.nurtureAt) return; // set by the nurture action
  if (s?.interest === 'no') return setOutcome(businessId, lead._id, 'not_interested', s.requirements?.length ? 'Not interested' : 'Not interested — closed', null);
  if (s?.interest === 'yes') return setOutcome(businessId, lead._id, 'interested', s.requirements?.[0] ? `Interested: ${s.requirements[0].slice(0, 120)}` : 'Interested — send details & follow up', new Date(clock.now().getTime() + 2 * 86400_000));
  if (st?.stage === 'scheduling' && st.schedulingKind === 'callback') {
    const at = new Date(clock.now().getTime() + 86400_000);
    return setOutcome(businessId, lead._id, 'callback', 'Busy — asked for a call back (no time given, trying tomorrow)', at);
  }
}
