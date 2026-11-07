import { env } from '../../config/env.js';
import type { TelephonyProvider, DialRequest } from './types.js';
import { enqueue } from '../../queue/queue.js';

/**
 * SIMULATOR — no real phone call is placed. A synthetic prospect (scripted personas, or LLM-played when an
 * OpenAI key is configured) talks to the real AI agent engine so campaigns, transcripts, analysis, booking,
 * opt-outs and retries can be exercised end-to-end. Call records are marked provider = "simulator".
 */
export const simulator: TelephonyProvider = {
  id: 'simulator',
  async dial(req: DialRequest) {
    const id = `SIM-${req.callId}`;
    await enqueue('calls.simulate', { callId: req.callId }, { businessId: req.businessId, runAt: new Date(Date.now() + Math.min(env.SIMULATOR_SPEED_MS, 1500)), maxAttempts: 1, uniqueKey: `sim:${req.callId}` });
    return { providerCallId: id };
  },
};

export type Persona = 'call_later' | 'interested' | 'curious' | 'busy' | 'not_interested' | 'opt_out' | 'asks_ai' | 'later' | 'skeptic' | 'competitor' | 'send_email' | 'price_shopper' | 'happy';
export const PERSONA_SCRIPTS: Record<Persona, string[]> = {
  interested: ['Yes, sure, go ahead.', 'We mostly handle it manually with spreadsheets right now, it is getting hard to manage.', 'The biggest challenge is following up with customers on time. We are looking for something better.', 'Probably within the next month, budget maybe a few hundred a month.', 'Yes, that sounds good.', 'Tomorrow at 3 pm works for me.', 'No, that is all. Thank you!'],
  curious: ['Okay, I have a couple of minutes.', 'What exactly do you offer and how much does it cost?', 'Do you offer support?', 'Interesting. Tell me more.', 'Sure, Thursday at 11 am.', 'No, thanks, that is it.'],
  busy: ["Sorry, I'm in a meeting right now, can you call me back later?", 'Tomorrow evening would be better.'],
  not_interested: ['Who is this?', "We're not interested, we already have a vendor.", 'No, really not interested. Thanks.'],
  opt_out: ['Please do not call me again and remove my number.'],
  call_later: ["Sorry, I'm in the middle of something, can you call me back later?", 'Tomorrow evening would be better.'],
  later: ['Okay, go ahead.', 'Honestly not right now, we are slammed this season. Maybe check back in two months.'],
  // Tough customers — the kinds of calls real reps get every day
  skeptic: ['Is this a sales call?', 'Okay, 30 seconds.', 'Quiet days mostly, Tuesdays are dead.', 'Maybe 5 or 6 empty slots a week.', 'Alright, worth a look.', 'Wednesday at 10 am.', 'No, that is it.'],
  competitor: ['Sure.', 'We already use Vagaro.', 'Clients like booking online.', 'Honestly the fees, and people still forget appointments.', 'Okay, sure.', 'Thursday at 2 pm works.', 'Nope, thanks.'],
  send_email: ['Okay.', 'Just send me an email.', 'Probably the no-shows.', 'About 3 a week.', 'I would have to talk to my business partner first.', 'Yes, Friday at 10 am.', 'No, all good.'],
  price_shopper: ['Go on.', 'How much does it cost?', "That's too expensive for us right now.", 'No, really not interested.'],
  happy: ['Go ahead.', 'We already have a system that works.', 'It just works, the team knows it.', 'Nothing really.', 'Sure, that is fine.'],
  asks_ai: ['Wait, are you a robot?', 'Okay, fine, go ahead.', 'We use an old system for that.', 'Not really, no thanks.', 'Bye.'],
};

/** Weighted outcome for a simulated dial. Deterministic per call id so retries vary but tests are stable. */
export function simulatedOutcome(seedStr: string, attempt = 1): { result: 'answered' | 'missed' | 'busy' | 'failed'; persona: Persona } {
  // FNV-1a + murmur3 finaliser: near-identical ids (created in the same second) still spread evenly across personas
  let h = 0x811c9dc5; for (const c of seedStr + attempt) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16; h >>>= 0;
  const r = (h % 1000) / 1000;
  const result = r < 0.68 ? 'answered' : r < 0.86 ? 'missed' : r < 0.95 ? 'busy' : 'failed';
  const personas: Persona[] = ['interested', 'interested', 'curious', 'skeptic', 'competitor', 'send_email', 'busy', 'not_interested', 'price_shopper', 'happy', 'asks_ai', 'later', 'opt_out'];
  return { result, persona: personas[(h >>> 10) % personas.length] };
}
