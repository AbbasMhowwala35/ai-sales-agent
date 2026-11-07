import { DateTime } from 'luxon';
import { tokenize } from '../../providers/embeddings/index.js';
import { clock } from '../../lib/clock.js';
import { audienceFor, offerTypeFor } from './categories.js';

/**
 * SALES PLAYBOOK — how a top cold caller runs a call, encoded so both the rule engine and the LLM prompt use it.
 *
 * Built on published cold-call research and well-known methods:
 *  - State the reason for the call up front (Gong: 2.1× success) and ask for a short, specific slice of time;
 *    avoid “did I catch you at a bad time?” (Gong: 40% less likely to book).
 *  - Problem-centred pitch: name the 2–3 problems peers usually have and let them pick (“problem menu”).
 *  - Discovery → impact: label what they said (Voss: “sounds like…”), then quantify how often it happens.
 *  - Tie THEIR words to ONE offer, back it with a proof point the owner supplied, then “sell the test drive”
 *    (a free 15-minute look, not the product) with two concrete day options.
 *  - Objections (Gong, 300M calls): agree → get them talking → low-pressure next step. One honest attempt, then
 *    exit warmly and leave the door open. Never argue, never bash a competitor, never invent facts.
 *  - Honesty is fixed: AI disclosure, truthful answers, opt-outs honoured instantly.
 */

export interface Pain { pain: string; offer?: string; want?: boolean }
export interface SalesProfile { audience: string; pains: Pain[]; proof: string[]; reason: string; impactQ: string }

const sentences = (s?: string) => (s ?? '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const lc = (s: string) => s.replace(/^./, (c) => c.toLowerCase()).replace(/\.$/, '');

/**
 * Who we call, what usually hurts them, and what we can honestly prove — worked out by the agent itself from the
 * campaign's category and the business's own products (no settings to fill in). When an LLM is configured, a
 * richer per-campaign version is generated once and cached on the campaign (campaign.salesProfile).
 */
export function salesProfile(ctx: { business: any; campaign?: any; lead?: any }): SalesProfile {
  const b = ctx.business ?? {};
  const cat = String(ctx.campaign?.category || ctx.lead?.category || b.icp?.industries?.[0] || '').trim();
  const aud = audienceFor(cat);
  const cached = ctx.campaign?.salesProfile;
  const offer = offerTypeFor(b);
  const items: any[] = [...(b.products ?? []), ...(b.services ?? [])].filter((p) => p?.name);
  let pains: Pain[] = cached?.pains?.length ? cached.pains.map((p: any) => ({ pain: String(p.pain ?? p), offer: p.offer }))
    : offer ? offer.pains(aud).map((pain) => ({ pain }))
    : items.filter((it) => it.description).slice(0, 3).map((it) => ({ pain: lc(String(it.description).split(/[.;,]|\bplus\b|\bsynced\b/)[0].trim()), offer: it.name, want: true }));
  pains = pains.slice(0, 3).map((p) => ({ ...p, offer: p.offer && items.some((i) => i.name === p.offer) ? p.offer : offerFor(items, p.pain)?.name }));
  const proof = sentences(b.description).filter((x) => /\d/.test(x)).slice(0, 3);
  const objective = ctx.campaign?.objective ? lc(String(ctx.campaign.objective).replace(/^(about|regarding)\s+/i, '')) : '';
  const reason = cached?.oneLiner ? lc(String(cached.oneLiner))
    : offer ? offer.reason(aud)
    : objective ? `it’s about ${objective}`
    : pains.length ? `we help ${aud.owners} with ${pains[0].want ? pains[0].pain.split(/\s+(with|on|for|via)\s+/)[0] : pains[0].pain}` : `we help ${aud.owners} grow without adding staff`;
  const impactQ = offer?.impact?.(aud) ?? 'Roughly how often does that happen — like, in a typical week?';
  return { audience: cached?.audience || aud.owners, pains, proof, reason, impactQ };
}

/** The product that fixes a given problem: same topic first (no-shows ↔ reminders), then shared words. */
export function offerFor(items: any[], pain: string) {
  if (!items.length) return undefined;
  const want = topics(pain);
  const byTopic = items.find((it) => [...topics(`${it.name} ${it.description ?? ''}`)].some((i) => want.has(i)));
  if (byTopic) return byTopic;
  const toks = new Set(tokenize(pain).filter((t) => !GENERIC.has(t)));
  let best: { it: any; n: number } | undefined;
  for (const it of items) { const n = tokenize(`${it.name} ${it.description ?? ''}`).filter((t) => toks.has(t)).length; if (n && (!best || n > best.n)) best = { it, n }; }
  return best?.it ?? items[0];
}

/** One-off, per campaign: let the LLM tailor the pitch to this exact category and offer. Cached on the campaign. */
export async function generateSalesProfile(business: any, campaign: any) {
  const { getLLM, safeJson } = await import('../../providers/llm/index.js');
  const llm = getLLM();
  if (!llm || !campaign?.category) return undefined;
  const base = salesProfile({ business, campaign: { ...campaign, salesProfile: undefined } });
  const offer = [...(business.products ?? []), ...(business.services ?? [])].map((p: any) => `${p.name}: ${p.description ?? ''}`).join('; ');
  const r = await llm.chat([
    { role: 'system', content: 'You are a top B2B cold-calling coach. Return JSON only: {"audience": string (plural, how you would say it out loud, e.g. "dental clinic owners"), "oneLiner": string (starts with "we help", under 16 words, concrete outcome, no hype), "pains": [3 short problems in the prospect\'s own words, each under 9 words, that THIS seller can actually solve]}. Never invent statistics or customers.' },
    { role: 'user', content: `Seller: ${business.name} — ${business.description ?? ''}\nOffer: ${offer}\nCalling: ${campaign.category}${campaign.research?.locations?.length ? ' in ' + campaign.research.locations.join(', ') : ''}\nDefault draft: ${JSON.stringify(base)}` },
  ], { json: true, temperature: 0.4, maxTokens: 300 });
  const j = safeJson(r.content);
  if (!j?.oneLiner || !Array.isArray(j.pains) || j.pains.length < 2) return undefined;
  return { audience: String(j.audience ?? base.audience).slice(0, 60), oneLiner: String(j.oneLiner).slice(0, 160), pains: j.pains.slice(0, 3).map((p: any) => ({ pain: String(p).slice(0, 80) })), generatedAt: new Date() };
}

const join3 = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')}, or ${xs.at(-1)}`);

/** “Most salon owners I talk to are dealing with one of three things…” */
/** The proof point that matches the problem they raised (or none — never a mismatched claim). */
const topics = (t: string) => new Set(SYNONYMS.map(([re], i) => (re.test(t) ? i : -1)).filter((i) => i >= 0));
/** Do two phrases talk about the same kind of problem? */
export function sameTopic(a: string, b: string) { const x = topics(a); return [...topics(b)].some((i) => x.has(i)); }
export function relevantProof(p: SalesProfile, about: string) {
  const want = topics(about);
  return p.proof.find((x) => { const have = topics(x); return have.size ? [...have].some((i) => want.has(i)) : false; });
}

export function problemMenu(p: SalesProfile) {
  if (!p.pains.length) return `Out of curiosity, what’s the one thing about running the business that eats most of your week right now?`;
  const n = p.pains.length === 3 ? 'one of three things' : p.pains.length === 2 ? 'one of two things' : 'one thing';
  if (p.pains[0].want) return `Most ${p.audience} I talk to are after ${n} — ${join3(p.pains.map((x) => x.pain))}. Is any of that on your radar right now?`;
  return `Most ${p.audience} I talk to are dealing with ${n} — ${join3(p.pains.map((x) => x.pain))}. Does any of that sound familiar, or are you in good shape there?`;
}

/** Which of our listed pains did they just pick? */
/** Customers describe problems in their own words — map common phrasings onto the playbook's wording. */
const SYNONYMS: [RegExp, string][] = [
  [/no.?shows?|not showing|showing up|don'?t (show|turn up)|forget|flak(e|y)|cancel|reminders?/i, 'not showing up no-shows cancellations'],
  [/miss(ed|ing)? (the )?(calls?|phone)|phone (ringing|calls?)|calls?\b|voicemail|can'?t answer|online booking|book online|24\/7/i, 'phone ringing calls'],
  [/quiet|empty|dead|slow (days|weeks?|season|months?)|fill (the )?(chairs|book|gaps)|gaps? in|win.?back|rebook|fewer (clients|bookings)|not enough (clients|customers)/i, 'quiet days empty chairs'],
  [/admin|paperwork|spreadsheet|by hand|manual/i, 'admin manual time'],
  [/website|online|google|instagram/i, 'website online'],
  [/reviews?|ratings?/i, 'reviews'],
];
const GENERIC = new Set(['client', 'clients', 'customer', 'customers', 'people', 'business', 'while', 'with', 'your', 'you', 'the', 'our', 'days', 'day', 'time']);
export function matchPain(p: SalesProfile, text: string): Pain | undefined {
  const toks = new Set(tokenize(`${text} ${SYNONYMS.filter(([re]) => re.test(text)).map(([, w]) => w).join(' ')}`));
  let best: { pain: Pain; s: number } | undefined;
  p.pains.forEach((x, i) => {
    const w = tokenize(x.pain).filter((t) => !GENERIC.has(t));
    let s = w.filter((t) => toks.has(t)).length / Math.max(1, Math.sqrt(w.length));
    if (/\b(first|1st) (one)?\b/i.test(text) && i === 0) s += 1;
    if (/\b(second|2nd|middle) (one)?\b/i.test(text) && i === 1) s += 1;
    if (/\b(third|3rd|last) (one)?\b/i.test(text) && i === p.pains.length - 1) s += 1;
    if (/\b(all of (them|those|that)|all three|both)\b/i.test(text) && i === 0) s += 0.5;
    if (s > 0 && (!best || s > best.s)) best = { pain: x, s };
  });
  return best?.pain;
}

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, couple: 2, few: 3, handful: 4 };
/** “maybe 4 or 5 a week” → 5 per week. Returns undefined when no frequency was given. */
export function extractFrequency(text: string): { n: number; per: 'day' | 'week' | 'month' } | undefined {
  const t = text.toLowerCase();
  const m = t.match(/(\d+)(?:\s*(?:-|to|or)\s*(\d+))?|\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|couple|few|handful)\b/);
  if (!m) return undefined;
  const n = m[2] ? Number(m[2]) : m[1] ? Number(m[1]) : NUM_WORDS[m[3]];
  if (!n || n > 500) return undefined;
  const per = /\b(a|per|each|every) day|daily\b/.test(t) ? 'day' : /\b(a|per|each|every) month|monthly\b/.test(t) ? 'month' : 'week';
  return { n, per };
}
export function impactLine(f: { n: number; per: 'day' | 'week' | 'month' }) {
  if (f.per === 'month') return `So around ${f.n} a month — that’s ${f.n * 12} a year.`;
  const month = f.per === 'day' ? f.n * 22 : Math.round(f.n * 4.3);
  return `So roughly ${f.n} a ${f.per} — that’s about ${month} a month.`;
}

/** Two concrete upcoming weekdays in the prospect’s zone, for an easy either/or close. */
export function twoDays(zone: string, now = clock.now()) {
  let d = DateTime.fromJSDate(now).setZone(zone).plus({ days: 1 });
  const out: string[] = [];
  while (out.length < 2) { if (d.weekday <= 5) out.push(out.length === 0 && d.hasSame(DateTime.fromJSDate(now).setZone(zone).plus({ days: 1 }), 'day') ? 'tomorrow' : d.toFormat('cccc')); d = d.plus({ days: 1 }); }
  return out as [string, string];
}

export type ObjectionKind = 'sales_call' | 'how_number' | 'send_info' | 'has_solution' | 'no_budget' | 'partner' | 'too_small' | 'who_is_this';
const OBJ: [ObjectionKind, RegExp][] = [
  ['how_number', /how (did|do) you (get|find) (my|this) (number|details|info)|where did you get (my|this) number|who gave you (my|this) number/],
  ['sales_call', /\b(is this|this is) (a |an )?(sales|cold|marketing|telemarketing) call|are you selling|trying to sell me/],
  ['who_is_this', /^\W*(who is this|who's this|who is calling|who are you|sorry,? who)\W*$/],
  ['send_info', /\b(send|email|e-mail|text|whatsapp) (me )?(some |the |more )?(info|information|details|something|it|a brochure|over)|just (email|send)|put it in an email/],
  ['partner', /\b(talk|speak|check|run it by|discuss) (to |with )?(my )?(partner|wife|husband|business partner|manager|boss|team|co-?owner|accountant)|not my decision|(partner|boss|manager) (decides|handles|makes)/],
  ['too_small', /\b(too small|just me|only me|one.?(person|chair|woman|man) (shop|business|salon)|tiny (shop|business|salon)|small (shop|operation))/],
  ['no_budget', /\b(no budget|can'?t afford|too expensive|money is tight|tight on (money|cash|budget)|cost too much|costs too much|no money)\b/],
  ['has_solution', /\b(already (have|use|got|using|work with)|we use|we'?re using|happy with (what|our|the)|our (current|own) (system|software|app|vendor|provider)|we have (a|an|our own) (system|vendor|provider|app|someone)|in.?house|(locked|stuck) in (a )?contract)/],
];
export function classifyObjection(text: string): ObjectionKind | undefined {
  const t = text.toLowerCase().replace(/[’']/g, "'");
  return OBJ.find(([, re]) => re.test(t))?.[0];
}
/** The competitor or tool they named (“we use Vagaro”), for the follow-up question. */
export function namedTool(text: string) {
  const m = text.match(/\b(?:use|using|have|with|got)\s+([A-Z][\w&.-]+(?:\s+[A-Z][\w&.-]+)?)/);
  const w = m?.[1];
  return w && !/^(It|A|An|The|Our|We|I|Something|Someone|One)$/.test(w) ? w : undefined;
}

/** Words to avoid: they sound like a script, oversell, or create false urgency. */
export const BANNED_PHRASES = [/\bto be honest with you\b/i, /\bact now\b/i, /\blimited time\b/i, /\bguarantee(d)?\b/i, /\bas an ai\b/i, /\bi understand your frustration\b/i, /\bcircle back\b/i, /\btouch base\b/i, /\bsynergy\b/i, /\bwould you be the right person\b/i];

/** Short version for the LLM system prompt. */
export function playbookPrompt(p: SalesProfile, zone: string) {
  const [d1, d2] = twoDays(zone);
  return `SALES PLAYBOOK (follow it — this is how the best cold callers sell):
1. OPENER is done. If they gave permission, give a 1-sentence reason (${p.reason}) then the PROBLEM MENU: "${problemMenu(p)}"
2. DISCOVERY: when they name a problem, LABEL it ("Sounds like the no-shows are the real headache") then ask ONE impact question (how often / how many a week). Use their numbers back to them ("so ~5 a week — about 20 a month"). Never invent money figures.
3. PITCH: connect THEIR words to ONE offer${p.pains.some((x) => x.offer) ? ` (${p.pains.filter((x) => x.offer).map((x) => `${x.pain} → ${x.offer}`).join('; ')})` : ''}. Add at most one proof point, only from: ${p.proof.length ? p.proof.map((x) => `"${x}"`).join(' / ') : '(none — use no proof claims)'}.
4. CLOSE with a test drive, not a purchase: "Worth 15 minutes on Google Meet to see how it'd work for you? I've got ${d1} or ${d2} — which is better?"
5. OBJECTIONS: agree first, then get them talking with a question, then offer the low-pressure next step. "Not interested" → "Totally fair — you weren't expecting my call. Is it that you've got this handled, or just not a priority right now?" "Send me info" → agree, then ask which problem matters most so it's useful. "We already use X" → don't criticise it; "What do you like most about it?" then "If you could change one thing?" "No budget" → the 15-minute look is free and shows whether it pays for itself. "Is this a sales call?" → be blunt: "It is — give me 30 seconds and you decide." "How did you get my number?" → tell the truth (public business listing) and offer to remove them.
6. ONE honest attempt per objection. After a second no, stop selling: thank them, leave the door open, end. Never pressure, never fake urgency or scarcity, never argue.
7. Talk like a person: short sentences, plain words, use "we" for the company, their name once in a while, no jargon.`;
}
