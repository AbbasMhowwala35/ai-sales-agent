import { Call, CallTranscript, Lead } from '../../models/index.js';
import { getLLM, safeJson } from '../../providers/llm/index.js';
import { detectIntents, extractBudget, extractTimeline } from '../agent/nlu.js';
import { addToDnc, notifyOutcome } from './lifecycle.js';
import type { ConversationState } from '../agent/engine.js';

const POS = /\b(great|good|interested|sounds good|perfect|love|helpful|thanks|thank you|yes|sure|excellent|awesome|definitely|keen)\b/gi;
const NEG = /\b(not interested|no|busy|stop|annoying|expensive|waste|don't|never|bad|angry|remove|unhappy|terrible)\b/gi;

export function heuristicAnalysis(customerText: string, state?: ConversationState) {
  const pos = (customerText.match(POS) ?? []).length;
  const neg = (customerText.match(NEG) ?? []).length;
  const score = +((pos - neg) / Math.max(1, pos + neg)).toFixed(2);
  const label = score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral';
  const i = detectIntents(customerText);
  const booked = !!state?.slots?.meetingAt;
  const meeting = booked && state?.slots?.meetingKind !== 'callback';
  const callback = booked && !meeting;
  const interested = meeting || state?.slots?.interest === 'yes' || (i.interested && !i.notInterested);
  const intent = meeting ? 'high' : interested ? 'medium' : i.notInterested || i.optOut || state?.slots?.interest === 'no' ? 'none' : 'low';
  const qScore = { high: 85, medium: 60, low: 30, none: 5 }[intent];
  const requirements = state?.slots?.requirements?.slice(0, 5) ?? [];
  if (state?.slots?.nurtureAt) {
    return {
      summary: `Not the right time — asked to be contacted again in ${state.slots.nurtureLabel ?? 'a while'}.${requirements.length ? ` Context: ${requirements[0].slice(0, 120)}.` : ''}`,
      sentiment: { label: label as 'positive' | 'neutral' | 'negative', score }, qualification: { interested: false, intent: 'low' as const, requirements, budget: state.slots.budget, timeline: state.slots.nurtureLabel, score: 35 },
      keyPoints: requirements.slice(0, 3), objections: state.objections ?? [],
      nextAction: `Automatic follow-up call on ${new Date(state.slots.nurtureAt).toDateString()}`, optOut: false,
    };
  }
  const nextAction = i.optOut ? 'Do not contact — number added to DNC list'
    : state?.slots?.interest === 'no' ? 'Closed — not interested. No further calls.'
    : booked && state?.slots?.meetingKind === 'meeting' ? 'Prepare for the scheduled meeting and send a pre-read'
    : booked ? 'Call back at the requested time'
    : interested ? 'Send product details by email and follow up in 2 days'
    : i.busy ? 'Retry at a better time' : 'Nurture with an email sequence; revisit next quarter';
  return {
    summary: `${callback && !interested ? 'Prospect was busy and asked for a callback' : interested ? `Prospect showed interest${booked ? ` and booked a ${callback ? 'callback' : 'meeting'}` : ''}` : i.optOut ? 'Prospect asked not to be contacted' : 'Prospect was not interested'}.${requirements.length ? ` Needs: ${requirements[0].slice(0, 120).replace(/[.!?\s]+$/, '')}.` : ''}${state?.slots?.budget ? ` Budget mentioned: ${state.slots.budget}.` : ''}${state?.slots?.timeline ? ` Timeline: ${state.slots.timeline}.` : ''}`,
    sentiment: { label, score },
    qualification: { interested, intent, requirements, budget: state?.slots?.budget ?? extractBudget(customerText), timeline: state?.slots?.timeline ?? extractTimeline(customerText), score: qScore },
    keyPoints: requirements.slice(0, 3),
    objections: state?.objections ?? [],
    nextAction,
    optOut: i.optOut,
  };
}

/** Post-call AI analysis: summary, sentiment, qualification, next best action. */
export async function analyzeCall(callId: string, businessId: string) {
  const call = await Call.findOne({ businessId, _id: callId }).select('+state');
  if (!call?.transcriptId) return;
  const t = await CallTranscript.findOne({ businessId, _id: call.transcriptId }).lean();
  if (!t) return;
  const state = call.state as ConversationState | undefined;
  const customerText = t.segments.filter((s) => s.speaker === 'customer').map((s) => s.text).join(' ');
  let a = heuristicAnalysis(customerText, state);
  const llm = getLLM();
  if (llm && t.fullText) {
    try {
      const r = await llm.chat([
        { role: 'system', content: 'You analyse sales call transcripts. Return JSON: {"summary": string (2-3 sentences), "sentiment": {"label":"positive"|"neutral"|"negative","score":-1..1}, "qualification": {"interested": boolean, "intent":"high"|"medium"|"low"|"none", "requirements": string[], "budget"?: string, "timeline"?: string, "score": 0-100}, "keyPoints": string[], "objections": string[], "nextAction": string, "optOut": boolean}' },
        { role: 'user', content: t.fullText.slice(0, 12000) },
      ], { json: true, temperature: 0.1, maxTokens: 600 });
      const j = safeJson(r.content);
      if (j.summary) a = { ...a, ...j, optOut: a.optOut || !!j.optOut, sentiment: j.sentiment ?? a.sentiment, qualification: { ...a.qualification, ...(j.qualification ?? {}) } };
    } catch { /* keep heuristic */ }
  }
  // Meeting brief: what the AI learned and offered, so the owner walks into the meeting prepared.
  const brief = await buildBrief(t, state, a, businessId);
  await Lead.updateOne({ businessId, _id: call.leadId }, { brief: { ...brief, callId: call._id, updatedAt: new Date() } });
  const { scoreCall } = await import('./scorecard.js');
  const turns = t.segments.filter((x) => x.speaker !== 'system' && x.text).map((x) => ({ who: x.speaker as 'agent' | 'customer', text: String(x.text) }));
  const scorecard = scoreCall(turns, { booked: !!call.appointmentId || state?.slots?.meetingKind === 'meeting', callback: state?.slots?.meetingKind === 'callback', nurture: !!state?.slots?.nurtureAt, optOut: !!(a.optOut || state?.optOut), notInterested: state?.slots?.interest === 'no' });
  call.set({ scorecard, summary: a.summary, sentiment: a.sentiment, qualification: a.qualification, keyPoints: a.keyPoints, objections: a.objections, nextAction: a.nextAction, analysisStatus: 'done', ...(a.optOut ? { optOut: true } : {}) });
  await call.save();
  const lead = await Lead.findOne({ businessId, _id: call.leadId });
  if (!lead) return;
  // Providers without engine state (e.g. Vapi): derive the outcome from the analysis.
  if (['none', 'no_answer', 'busy'].includes(lead.outcome ?? 'none') && !state?.slots) {
    const { setOutcome } = await import('./lifecycle.js');
    if (a.optOut) await setOutcome(businessId, lead._id, 'do_not_call', 'Asked not to be called', null);
    else if (call.appointmentId) await setOutcome(businessId, lead._id, 'meeting', 'Meeting booked on the call');
    else if (a.qualification.intent === 'none') await setOutcome(businessId, lead._id, 'not_interested', 'Not interested — closed', null);
    else if (a.qualification.interested) await setOutcome(businessId, lead._id, 'interested', a.nextAction, new Date(Date.now() + 2 * 86400_000));
  }
  if (a.optOut && !lead.doNotCall) await addToDnc(businessId, lead, 'opt_out', `Detected in transcript of call ${callId}`);
  if (a.qualification.intent === 'high' || a.qualification.intent === 'medium') {
    lead.score = Math.min(100, Math.max(lead.score, Math.round((lead.score + (a.qualification.score ?? 60)) / 2) + 10));
    lead.temperature = lead.score >= 70 ? 'hot' : 'warm';
    if (['new', 'qualified', 'contacted'].includes(lead.status)) lead.status = 'interested';
    await lead.save();
    await notifyOutcome(businessId, lead, 'Interested prospect', `${lead.companyName}: ${a.summary.slice(0, 160)}`);
  }
}

async function buildBrief(t: any, state: ConversationState | undefined, a: any, businessId: string) {
  const { Business } = await import('../../models/index.js');
  const b = await Business.findById(businessId, { products: 1, services: 1 }).lean();
  const offers = [...(b?.products ?? []), ...(b?.services ?? [])].map((p: any) => p.name).filter(Boolean);
  const agentText = t.segments.filter((s: any) => s.speaker === 'agent').map((s: any) => s.text).join(' ');
  const customerLines: string[] = t.segments.filter((s: any) => s.speaker === 'customer').map((s: any) => s.text);
  const offered = [...new Set([...(state?.slots?.offered ?? []), ...offers.filter((o: string) => agentText.toLowerCase().includes(o.toLowerCase()))])];
  const pains = [...new Set([...(state?.slots?.pains ?? []), ...customerLines.filter((l) => /(problem|hard|struggl|no.?show|manual|spreadsheet|phone|slow|expensive|missing|lose|losing|forget|busy|quiet|need)/i.test(l))])].slice(0, 5);
  const quotes = customerLines.filter((l) => l.split(/\s+/).length >= 5).slice(0, 4);
  const talkingPoints: string[] = [];
  for (const p of pains.slice(0, 3)) talkingPoints.push(`They said “${p.slice(0, 90)}” — show exactly how ${offered[0] ?? 'our product'} fixes this.`);
  if (a.qualification?.budget) talkingPoints.push(`Budget mentioned: ${a.qualification.budget} — come with pricing that fits it.`);
  if (a.qualification?.timeline) talkingPoints.push(`Timeline: ${a.qualification.timeline}.`);
  for (const o of (a.objections ?? []).slice(0, 2)) talkingPoints.push(`Be ready for the objection: “${String(o).slice(0, 90)}”.`);
  if (!talkingPoints.length) talkingPoints.push('Open by asking how they handle this today — the AI didn’t capture specific pains.');
  let brief = { summary: a.summary, pains, offered, wants: (a.qualification?.requirements ?? []).slice(0, 5), objections: a.objections ?? [], talkingPoints, budget: a.qualification?.budget, timeline: a.qualification?.timeline, quotes };
  const llm = getLLM();
  if (llm && t.fullText) {
    try {
      const r = await llm.chat([
        { role: 'system', content: 'You prepare a salesperson for a follow-up meeting. From the call transcript return JSON {"summary": string (2 sentences), "pains": string[], "offered": string[] (what our agent pitched), "wants": string[], "objections": string[], "talkingPoints": string[] (3-5 concrete, specific to this prospect), "budget"?: string, "timeline"?: string, "quotes": string[] (prospect\'s most telling exact words)}' },
        { role: 'user', content: t.fullText.slice(0, 12000) },
      ], { json: true, temperature: 0.2, maxTokens: 700 });
      const j = safeJson(r.content);
      if (j.summary) brief = { ...brief, ...j };
    } catch { /* keep heuristic */ }
  }
  return brief;
}
