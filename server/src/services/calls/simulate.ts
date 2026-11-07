import { Call } from '../../models/index.js';
import { beginConversation, conversationTurn, finalizeCall, loadCallContext } from './lifecycle.js';
import { PERSONA_SCRIPTS, simulatedOutcome, type Persona } from '../../providers/telephony/simulator.js';
import { getLLM } from '../../providers/llm/index.js';
import { env } from '../../config/env.js';
import { sleep } from '../../lib/time.js';

async function llmProspect(persona: Persona, lead: any, history: { role: string; content: string }[]) {
  const llm = getLLM();
  if (!llm) return null;
  const r = await llm.chat([
    { role: 'system', content: `You are role-playing ${lead?.contactName ?? 'a business owner'}, ${lead?.designation ?? 'decision maker'} at ${lead?.companyName ?? 'a company'}, receiving a sales call. Persona: ${persona.replace('_', ' ')}. Reply in one short spoken sentence. If you want to end the call say goodbye.` },
    ...history.map((m) => ({ role: (m.role === 'assistant' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.content })),
  ], { temperature: 0.8, maxTokens: 60 });
  return r.content.trim() || null;
}

export async function runSimulatedCall(callId: string, businessId: string) {
  const ctx = await loadCallContext(callId, businessId);
  if (!ctx || ctx.call.status === 'ended') return;
  const tags: string[] = ctx.lead?.tags ?? [];
  const forced = tags.find((t) => t.startsWith('sim:'))?.slice(4);
  let { result, persona } = simulatedOutcome(String(ctx.lead?._id ?? callId), ctx.call.attempt);
  if (forced && ['missed', 'busy', 'failed'].includes(forced)) result = forced as any;
  else if (forced && forced in PERSONA_SCRIPTS) { result = 'answered'; persona = forced as Persona; }

  if (result !== 'answered') {
    await sleep(env.SIMULATOR_SPEED_MS);
    return finalizeCall(callId, businessId, { result, endReason: { missed: 'No answer', busy: 'Line busy', failed: 'Carrier rejected the call' }[result] });
  }

  const opening = await beginConversation(callId, businessId);
  if (!opening) return;
  const segments: { speaker: 'agent' | 'customer'; text: string; start: number; end: number }[] = [];
  let t = 0.8;
  const speak = (speaker: 'agent' | 'customer', text: string) => {
    const dur = Math.max(1.2, text.split(/\s+/).length / (speaker === 'agent' ? 2.6 : 2.8));
    segments.push({ speaker, text, start: +t.toFixed(2), end: +(t + dur).toFixed(2) });
    t += dur + 0.7;
  };
  speak('agent', opening.reply);
  const script = PERSONA_SCRIPTS[persona];
  const history: { role: string; content: string }[] = [{ role: 'assistant', content: opening.reply }];
  let ended = false;
  for (let i = 0; i < 12 && !ended; i++) {
    const current = await Call.findOne({ businessId, _id: callId }, { status: 1 }).lean();
    if (current?.status === 'ended') return; // hung up externally
    let utter: string | null = null;
    try { utter = await llmProspect(persona, ctx.lead, history); } catch { utter = null; }
    if (!utter) utter = script[i] ?? (i >= script.length ? 'Okay, thanks, bye.' : null);
    if (!utter) break;
    speak('customer', utter);
    history.push({ role: 'user', content: utter });
    await sleep(env.SIMULATOR_SPEED_MS);
    const r = await conversationTurn(callId, businessId, utter);
    if (!r) break;
    speak('agent', r.reply);
    history.push({ role: 'assistant', content: r.reply });
    ended = r.end;
  }
  await finalizeCall(callId, businessId, { result: 'answered', durationSec: Math.round(t), segments, endReason: ended ? 'Conversation completed' : 'Prospect hung up' });
}
