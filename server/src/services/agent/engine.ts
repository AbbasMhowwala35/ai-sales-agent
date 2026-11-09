import { getLLM, safeJson, type ChatMessage } from '../../providers/llm/index.js';
import { brandName, isSolo, ownerFirst } from '../../lib/brand.js';
import { retrieve, extractiveAnswer } from '../knowledge/retrieve.js';
import { detectIntents, extractBudget, extractTimeline, parseMeetingTime, formatMeetingTime, parseFollowUp, timeParts } from './nlu.js';
import { tokenize } from '../../providers/embeddings/index.js';
import { leadTimezone } from '../calls/compliance.js';
import { offerTypeFor, audienceFor } from './categories.js';
import { salesProfile, relevantProof, sameTopic, problemMenu, matchPain, extractFrequency, impactLine, twoDays, classifyObjection, namedTool, playbookPrompt, type ObjectionKind } from './playbook.js';

/**
 * Conversation engine — one brain for live calls (Twilio turn loop), the simulator and the in-app test call.
 * Style goal: sounds like a seasoned human account executive (short, warm, confident, varied), while
 * staying honest: a one-line AI disclosure up front and a truthful answer whenever asked.
 */
export type Stage = 'consent' | 'discovery' | 'closing' | 'scheduling' | 'wrapup' | 'ended';
export interface ConversationState {
  stage: Stage;
  messages: { role: 'assistant' | 'user'; content: string; at: number }[];
  turns: number;
  discoveryStep: number;
  objectionCount: number;
  schedulingKind?: 'meeting' | 'callback';
  schedulingTries: number;
  slots: {
    interest: 'unknown' | 'yes' | 'no';
    requirements: string[];
    budget?: string;
    timeline?: string;
    meetingAt?: string;
    meetingKind?: 'meeting' | 'callback';
    nurtureAt?: string;
    nurtureLabel?: string;
    meetingWith?: 'owner' | 'specialist';
    pains: string[];
    offered: string[];
    pendingDay?: string;
    pain?: string;
    tool?: string;
    proofUsed?: boolean;
    noWebsite?: boolean;
    email?: string;
    sendInfo?: string;
    decisionMaker?: string;
    unknownQs?: number;
    entryPriceSaid?: boolean;
    proofAsked?: boolean;
  };
  /** What the agent asked last — used to interpret short answers like "no thanks" or "tomorrow". */
  lastAsk?: 'permission' | 'discovery' | 'meeting_offer' | 'time' | 'callback_time' | 'anything_else' | 'problem_menu' | 'impact' | 'reframe' | 'reframe_permission' | 'gap1' | 'gap2' | 'checkback' | 'nurture_pain' | 'gatekeeper' | 'email' | 'info_followup';
  recordingConsent?: boolean;
  optOut?: boolean;
  transfer?: boolean;
  endReason?: string;
  objections: string[];
}
export type EngineAction =
  | { type: 'book'; at: Date; kind: 'meeting' | 'callback'; display?: string; with?: 'owner' | 'specialist' }
  | { type: 'nurture'; at: Date; label: string }
  | { type: 'opt_out' }
  | { type: 'not_interested' }
  | { type: 'recording_consent'; granted: boolean }
  | { type: 'transfer'; number: string };
export interface TurnResult { reply: string; end: boolean; actions: EngineAction[]; state: ConversationState }
export interface EngineContext { business: any; agent: any; lead?: any; campaign?: any; now?: Date }

/** "Priya Sharma" → "Priya"; "Dr. Anjali Mehta" → "Dr. Mehta" (never just "Dr."). */
const firstName = (n?: string) => {
  const w = (n ?? '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  if (/^(dr|mr|mrs|ms|miss|prof|sir|shri|smt)\.?$/i.test(w[0])) return w.length > 1 ? `${w[0].replace(/\.?$/, '.').replace(/^./, (c) => c.toUpperCase())} ${w[w.length - 1]}` : '';
  return w[0];
};
const DISCLOSURE_RE = /\b(ai|a\.i\.|artificial intelligence|virtual assistant|automated assistant|digital assistant)\b/i;

export function newState(): ConversationState {
  return { stage: 'consent', messages: [], turns: 0, discoveryStep: 0, objectionCount: 0, schedulingTries: 0, slots: { interest: 'unknown', requirements: [], pains: [], offered: [] }, objections: [], lastAsk: 'permission' };
}

/** Meetings are booked in the prospect’s local time. */
function tz(ctx: EngineContext) { return leadTimezone(ctx.lead ?? {}, ctx.campaign?.schedule?.timezone ?? ctx.business?.compliance?.timezone ?? 'Asia/Kolkata'); }
function needsRecordingConsent(ctx: EngineContext) { const c = ctx.business?.compliance ?? {}; return c.recordCalls !== false && c.requireConsentForRecording !== false; }
function transferNumber(ctx: EngineContext) { return ctx.agent?.transferNumber || ctx.business?.transferNumber; }
const formal = (ctx: EngineContext) => ctx.agent?.style === 'formal';

/** Deterministic variety so the agent never repeats the exact same phrase twice in a row. */
function pick<T>(state: ConversationState, options: T[], salt = 0): T { return options[(state.turns * 7 + salt * 3 + state.messages.length) % options.length]; }
const ACK = ['Got it.', 'Makes sense.', 'Yeah, totally.', 'Okay, that’s helpful.', 'Right, I hear you.', 'Fair enough.'];
const ACK_FORMAL = ['Understood.', 'That makes sense.', 'Thank you, that’s helpful.', 'I appreciate that.'];
const ack = (ctx: EngineContext, s: ConversationState, salt = 0) => pick(s, formal(ctx) ? ACK_FORMAL : ACK, salt);

function valueProp(ctx: EngineContext) {
  const b = ctx.business;
  const desc = (b.description ?? '').split(/(?<=[.!?])\s/)[0]?.trim().replace(new RegExp(`^${(b.name ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), 'we ');
  const proof = (b.description ?? '').split(/(?<=[.!?])\s/).slice(1).find((x: string) => /\d/.test(x));
  if (desc) return `So the short version — ${desc.replace(/^we /, 'we ').replace(/\.$/, '')}.${proof ? ` ${proof.trim()}` : ''}`;
  const offer = [...(b.products ?? []), ...(b.services ?? [])].slice(0, 2).map((p: any) => p.name).filter(Boolean);
  return offer.length ? `So the short version — we help businesses like yours with ${offer.join(' and ')}.` : `So the short version — we help businesses like yours grow without adding headcount.`;
}

function topic(ctx: EngineContext) {
  const kws: string[] = (ctx.business.icp?.keywords ?? []).filter((k: string) => !k.toLowerCase().includes(ctx.business.name?.toLowerCase?.() ?? '\u0000'));
  const kw = [...kws].sort((a, b) => b.length - a.length)[0];
  return kw ? kw.toLowerCase() : 'that side of the business';
}

/** First line: who, where from, a one-line honest AI note, recording notice, and a soft permission ask. */
export function openingMessage(ctx: EngineContext) {
  const { business, agent, lead } = ctx;
  const name = firstName(lead?.contactName);
  const me = agent?.name ?? 'Aria';
  let intro = agent?.openingLine
    ? agent.openingLine.replace(/\{\{\s*name\s*\}\}/g, name).replace(/\{\{\s*company\s*\}\}/g, lead?.companyName ?? '').replace(/\{\{\s*business\s*\}\}/g, brandName(business)).replace(/\s+,/g, ',')
    : isSolo(business) ? `Hey${name ? ' ' + name : ''}, it’s ${me} — I work with ${ownerFirst(business)}.` : `Hey${name ? ' ' + name : ''}, it’s ${me} from ${business.name}.`;
  // When the lead has no name, "Hey {{name}}!" would read "Hey !" — tidy the leftover gap.
  intro = intro.replace(/\s+([!?.,])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  // A custom opening that already pitches and asks for time stands on its own — don't add a second pitch after it.
  const ownPitch = !!agent?.openingLine && (intro.split(/\s+/).length > 30 || /\?/.test(intro));
  const recorded = business?.compliance?.recordCalls !== false;
  if (!DISCLOSURE_RE.test(intro)) intro = `${intro.replace(/\s*$/, '')} Quick heads-up, I’m an AI assistant${recorded ? ', and this call’s recorded' : ''}.`;
  const rec = recorded && !/recorded/i.test(intro) ? ' This call’s recorded.' : '';
  if (ownPitch) return `${intro}${rec}`;
  // Research: stating the reason up front ~doubles success; asking “is this a bad time?” cuts bookings. So: reason + a small, specific ask.
  const reason = salesProfile(ctx).reason;
  const ask = formal(ctx) ? 'May I take 30 seconds, and you can decide if it’s worth a conversation?' : 'Can I have 30 seconds? Then you decide if it’s worth a chat.';
  return `${intro}${rec} The reason I’m calling — ${reason.replace(/^we /, 'we ')}. ${ask}`;
}

const DISCOVERY = [
  (ctx: EngineContext) => offerTypeFor(ctx.business)?.key === 'website'
    ? `Out of curiosity, how do people usually find ${ctx.lead?.companyName ?? 'you'} right now — Google, Instagram, or mostly word of mouth?`
    : `Out of curiosity, how are you handling ${topic(ctx)} at ${ctx.lead?.companyName ?? 'your place'} right now?`,
  () => `And what’s the part of that that costs you the most — time, money, or customers slipping through?`,
  () => `If you could fix that, is it something you’d want sorted in the next month or two, or more of a later-this-year thing?`,
];

/** "Starts $ 200" → "starts at $200"; "$99 per month" → "is $99 per month". */
function priceText(p: any) {
  const raw = String(p.price).replace(/([$₹£€])\s+/g, '$1').replace(/\s+/g, ' ').trim();
  const m = raw.match(/^(starts?|starting|from)\s*(at|from)?\s*(.+)$/i);
  return m ? `starts at ${m[3]}` : /^(free|included)/i.test(raw) ? `is ${raw.toLowerCase()}` : `is ${raw}`;
}
export function priceAnswer(ctx: EngineContext, q = '') {
  const items: any[] = [...(ctx.business.products ?? []), ...(ctx.business.services ?? [])].filter((p: any) => p?.name && p?.price);
  if (!items.length) return '';
  const cheapest = /cheap|lowest|smallest|basic|minimum|entry/i.test(q);
  const yearly = (p: any) => { const n = parseFloat(String(p.price).replace(/[^\d.]/g, '')) || 1e9; return /month|mo\b|monthly/i.test(p.price) ? n * 12 : /week/i.test(p.price) ? n * 52 : n; };
  const list = cheapest ? [items.slice().sort((a, b) => yearly(a) - yearly(b))[0]] : items.slice(0, 2);
  return `${list.map((p) => `${p.name} ${priceText(p)}`).join(', and ')}.`.replace(/^./, (c) => c.toUpperCase());
}
/** Turn a knowledge snippet into something you could say out loud: no bullets, no "Field:" labels, short. */
function speakable(t: string) {
  let out = t.replace(/(^|\s)[-•*]\s+/g, ' ').replace(/\b[A-Z][\w ]{2,24}:\s+/g, '').replace(/\s{2,}/g, ' ').trim();
  const words = out.split(/\s+/);
  if (words.length > 40) out = out.split(/(?<=[.!?])\s+/)[0];
  if (out.split(/\s+/).length > 40) out = out.split(/\s+/).slice(0, 35).join(' ').replace(/[,;:]?$/, '…');
  return out;
}
async function kbAnswer(ctx: EngineContext, q: string) {
  // Prices come straight from the business profile — never guessed, never from internal notes.
  if (detectIntents(q).price) { const p = priceAnswer(ctx, q); if (p) return p; }
  // The "Sales scripts" document is coaching for the caller, not something to read to a prospect.
  const chunks = (await retrieve(ctx.business._id, q, 4, 0.12)).filter((c) => !/script/i.test(c.title ?? '')).slice(0, 3);
  const kb = chunks.length ? extractiveAnswer(q, chunks, 2) : '';
  if (!kb) return '';
  // Only answer when the snippet shares real words with the question — otherwise it's a guess, and we don't guess.
  const STOP = new Set(['website', 'websites', 'business', 'you', 'your', 'our', 'can', 'do', 'does', 'the', 'what', 'how', 'through', 'with', 'for']);
  const qw = new Set(tokenize(q).filter((t) => !STOP.has(t)));
  const shared = new Set(tokenize(kb).filter((t) => qw.has(t)));
  if (qw.size >= 2 && shared.size < 2) return '';
  return speakable(kb);
}

function matchObjection(ctx: EngineContext, text: string) {
  const list: { objection: string; response: string }[] = ctx.agent?.objectionHandling ?? [];
  const toks = new Set(tokenize(text));
  let best: { score: number; response: string } | undefined;
  for (const o of list) {
    const ot = tokenize(o.objection);
    const s = ot.filter((x) => toks.has(x)).length / Math.max(1, ot.length);
    if (s > 0.3 && (!best || s > best.score)) best = { score: s, response: o.response };
  }
  return best?.response;
}

function captureSlots(state: ConversationState, text: string, i: ReturnType<typeof detectIntents>) {
  const budget = extractBudget(text); if (budget) state.slots.budget = budget;
  const timeline = extractTimeline(text); if (timeline) state.slots.timeline = timeline;
  if (i.interested || i.meeting) state.slots.interest = 'yes';
  if (i.notInterested && state.slots.interest !== 'yes') state.slots.interest = 'no';
}

const closingAsk = (ctx: EngineContext, s: ConversationState) => pick(s, [
  `Honestly, from what you’re telling me, this is exactly what we fix. Easiest next step is a quick 15-minute call with ${isSolo(ctx.business) ? ownerFirst(ctx.business) : 'one of our specialists'} — they’ll show you how it’d work for ${ctx.lead?.companyName ?? 'you'}. What does your week look like?`,
  `I think there’s a real fit here. Let’s get you 15 minutes with a specialist so you can see it on your own numbers — what day works best this week?`,
]);

const isCallbackTime = (t: string) => /\b(today|tonight|tomorrow|this (afternoon|evening)|in an? hour|in \d+ (minutes|hours)|monday|tuesday|wednesday|thursday|friday|\d{1,2}\s*(am|pm))\b/i.test(t);

const PAIN_RE: [RegExp, string][] = [
  [/(by hand|manual|manually|spreadsheet|excel|paper|notebook|diary|pen)/i, 'Yeah, doing that by hand eats hours every week.'],
  [/(phone|calls?|whatsapp|dm|instagram messages|texts?)/i, 'Right — juggling bookings over the phone and DMs gets messy fast.'],
  [/(no.?shows?|cancell|don'?t show|forget)/i, 'Ugh, no-shows are brutal — that’s money walking out the door.'],
  [/(slow (days|weeks?|season|months?|period)|business is slow|quiet|empty|dead|not enough (clients|customers)|need more (clients|customers|bookings)|fewer (clients|bookings))/i, 'Got it — a quieter book is exactly what we help with.'],
  [/(expensive|cost|paying too much|overpriced)/i, 'Makes sense — nobody wants to overpay for software.'],
  [/(old|outdated|clunky|hard to use|confusing|basic|slow|can'?t book online|no online booking)/i, 'Yeah, clunky tools slow everyone down.'],
  [/(no time|busy|swamped|stretched|short.?staffed)/i, 'Totally — when you’re stretched thin, admin is the first thing to slip.'],
];

/** Pick the product/service whose description best matches what the prospect just told us. */
function bestOffer(ctx: EngineContext, text: string) {
  const items: any[] = [...(ctx.business.products ?? []), ...(ctx.business.services ?? [])].filter((p) => p?.name);
  const toks = new Set(tokenize(text));
  let best: { item: any; score: number } | undefined;
  for (const it of items) {
    const words = tokenize(`${it.name} ${it.description ?? ''}`);
    const score = words.filter((w) => toks.has(w)).length / Math.sqrt(words.length + 1);
    if (!best || score > best.score) best = { item: it, score };
  }
  return best && best.score > 0 ? best.item : items[0];
}

function empathy(text: string) { return PAIN_RE.find(([re]) => re.test(text))?.[1]; }

/** Connect their words to our offer: “You said X → that’s exactly what Y does.” */
function painToOffer(ctx: EngineContext, state: ConversationState, text: string, prof?: ReturnType<typeof salesProfile>) {
  const e = empathy(text);
  const mapped = prof ? matchPain(prof, text)?.offer : undefined;
  const offer = (mapped && [...(ctx.business.products ?? []), ...(ctx.business.services ?? [])].find((p: any) => p.name === mapped)) || bestOffer(ctx, text);
  if (e) state.slots.pains.push(text.slice(0, 200));
  if (!offer) return e ?? ack(ctx, state);
  if (!state.slots.offered.includes(offer.name)) state.slots.offered.push(offer.name);
  let what = (offer.description ?? '').split(/[.;]/)[0].split(/,?\s+(plus|synced|so that|so you|which|that)\b/)[0].trim();
  if (what.split(/\s+/).length > 7) what = what.split(/\s+(with|on|for|via|across)\s+/)[0];
  what = what.replace(/,\s*$/, '').replace(/^./, (c: string) => c.toLowerCase());
  const own = String(offer.name).toLowerCase().startsWith(String(ctx.business.name ?? '').toLowerCase()) ? '' : 'our ';
  return `${e && !state.slots.pain ? e + ' ' : ''}That’s exactly what ${own}${offer.name} is for${what ? ` — ${what}` : ''}.`.replace(/^./, (c) => c.toUpperCase());
}

function bookReply(ctx: EngineContext, state: ConversationState, at: Date, kind: 'meeting' | 'callback', zone: string) {
  const when = formatMeetingTime(at, zone);
  state.slots.meetingAt = at.toISOString(); state.slots.meetingKind = kind;
  const who = isSolo(ctx.business) ? ownerFirst(ctx.business) : state.slots.meetingWith === 'owner' ? `our founder` : 'one of our specialists';
  if (kind === 'callback') { state.stage = 'ended'; return { reply: `Perfect — I’ll give you a ring ${when}. Talk then!`, end: true, actions: [{ type: 'book' as const, at, kind, display: when }] }; }
  state.stage = 'wrapup';
  const act = [{ type: 'book' as const, at, kind, display: when, with: state.slots.meetingWith ?? 'specialist' }];
  if (!ctx.lead?.email && !state.slots.email) { state.lastAsk = 'email'; return { reply: `Perfect — you’re booked with ${who} for ${when}, on Google Meet. What’s the best email to send the invite to?`, actions: act }; }
  state.lastAsk = 'anything_else';
  return { reply: `Perfect — you’re booked with ${who} for ${when}, on Google Meet. I’ll send the invite and link to ${state.slots.email ?? 'your email'}. Anything you’d like them to know beforehand?`, actions: act };
}

/** Rule-based dialogue manager — used offline and as a fallback if the LLM fails mid-call. */
async function ruleTurn(ctx: EngineContext, state: ConversationState, text: string, i: ReturnType<typeof detectIntents>): Promise<{ reply: string; end?: boolean; actions?: EngineAction[] }> {
  const name = firstName(ctx.lead?.contactName);
  const zone = tz(ctx);
  state.slots.pains ??= []; state.slots.offered ??= [];
  const bye = pick(state, [`Thanks${name ? ', ' + name : ''} — really appreciate your time. Have a great one!`, `Appreciate it${name ? ', ' + name : ''}. Take care!`, `Thanks so much — have a good rest of your day.`]);
  const parts = timeParts(text);
  const callbackContext = state.lastAsk === 'callback_time' || state.schedulingKind === 'callback';

  // ---- Answer to our one question before a “check back later” ----
  if (state.lastAsk === 'nurture_pain') {
    state.stage = 'ended';
    const skip = i.deny || i.nothingElse || i.goodbye || /^\W*(ok(ay)?|thanks?|thank you)\W*(thanks?|bye)?\W*$/i.test(text);
    if (!skip) { state.slots.pain = text.slice(0, 160); state.slots.pains.push(text.slice(0, 200)); }
    return { reply: `${skip ? 'No worries.' : 'Perfect, noted.'} Talk to you then${name ? ', ' + name : ''} — have a great one!`, end: true };
  }
  // ---- Wrap-up after booking: "no thanks" means "nothing else", not "not interested" ----
  if (state.stage === 'wrapup') {
    const email = text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0];
    if (email || state.lastAsk === 'email') {
      if (email) state.slots.email = email.toLowerCase();
      if (!email && (i.deny || i.nothingElse || i.notInterested)) {
        state.stage = 'ended';
        const when = state.slots.meetingAt ? formatMeetingTime(new Date(state.slots.meetingAt), zone) : '';
        return { reply: `No problem — I’ll send it by WhatsApp to this number instead.${when ? ` You’re all set for ${when}.` : ''} Talk soon${name ? ', ' + name : ''}!`, end: true };
      }
      state.lastAsk = 'anything_else';
      const what = state.slots.meetingAt ? 'The invite’s on its way.' : `${isSolo(ctx.business) ? ownerFirst(ctx.business) : 'The team'} will send the details there today.`;
      return { reply: email ? `Got it — ${email.toLowerCase()}. ${what} Anything you’d like ${isSolo(ctx.business) ? ownerFirst(ctx.business) : 'them'} to know beforehand?` : `No problem — I’ll send it by WhatsApp to this number instead. Anything you’d like ${isSolo(ctx.business) ? ownerFirst(ctx.business) : 'them'} to know beforehand?` };
    }
    if (i.question || i.price) {
      const ans = matchObjection(ctx, text) ?? (await kbAnswer(ctx, text));
      return { reply: `${ans || 'Good one — I’ll make sure that’s covered on the call.'} Anything else?` };
    }
    if (i.nothingElse || i.deny || i.notInterested || i.goodbye || i.affirm || text.trim().length < 3) {
      state.stage = 'ended';
      const when = state.slots.meetingAt ? formatMeetingTime(new Date(state.slots.meetingAt), zone) : '';
      return { reply: `Perfect${when ? ` — you’re all set for ${when}` : ''}. Talk soon${name ? ', ' + name : ''}!`, end: true };
    }
    state.slots.requirements.push(text.slice(0, 300));
    state.stage = 'ended';
    return { reply: `Got it — I’ll pass that straight on so they come prepared. ${bye}`, end: true };
  }

  const prof = salesProfile(ctx);
  const [d1, d2] = twoDays(zone);
  const owner = isSolo(ctx.business) ? ownerFirst(ctx.business) : 'our team';

  // ---- Talking to someone who isn't the decision maker (receptionist, staff) ----
  const gatekeeper = /\b(i'?m|i am) (just |only )?(the |a )?(receptionist|front desk|staff|employee|assistant|manager here|worker)|owner (is|isn'?t|is not|'s) (not )?(here|in|available|around|out)|(he|she|sir|madam|boss|owner) (is |'s )?(not here|not in|out|not available|away)|not the owner|malik (nahi|nahin) hai/i.test(text);
  if (state.lastAsk === 'gatekeeper' || gatekeeper) {
    if (state.lastAsk !== 'gatekeeper') {
      state.lastAsk = 'gatekeeper';
      return { reply: `Ah, no problem at all — thanks for picking up. When’s the best time to catch the owner, and who should I ask for?` };
    }
    const who = text.match(/\b(?:name is|ask for|speak (?:to|with)|called|it'?s)\s+((?:mr|mrs|ms|dr|sir)\.?\s+)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i);
    if (who) state.slots.decisionMaker = `${who[1] ? who[1].replace(/\.?\s*$/, '. ').replace(/^./, (c) => c.toUpperCase()) : ''}${who[2]}`.trim();
    const when = parseMeetingTime(/\b(today|tomorrow|kal|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(text) ? text : `tomorrow ${text}`, zone) ?? parseMeetingTime('tomorrow morning', zone)!;
    const display = formatMeetingTime(when, zone);
    state.stage = 'ended';
    return { reply: `Perfect — I’ll call back ${display}${state.slots.decisionMaker ? ` and ask for ${state.slots.decisionMaker}` : ''}. Thanks so much${name ? ', ' + name : ''}, have a great day!`, end: true, actions: [{ type: 'book', at: when, kind: 'callback', display }] };
  }

  // ---- They ask for details / examples / proof: say yes, honestly, and keep the door open ----
  const proofAsk = /\b(examples?|portfolio|past (work|projects?)|worked with|case stud(y|ies)|references?|testimonials?|scam|fraud|legit|genuine|trust you|how do i know|show me (your )?work)\b/i.test(text);
  const infoAsk = classifyObjection(text) === 'send_info' || /\b(send|share|email|whatsapp|mail)\b.{0,25}\b(details|info|information|portfolio|examples?|brochure|samples?|work|it|something)\b/i.test(text);
  // Early in the call, "just send me an email" is handled by the playbook (agree, then find the real problem first).
  const earlyInfo = infoAsk && !proofAsk && (state.lastAsk === 'problem_menu' || state.lastAsk === 'permission') && prof.pains.length >= 2;
  if (earlyInfo) { const ch = /whatsapp/i.test(text) ? 'WhatsApp' : /\b(e-?mail|mail)\b/i.test(text) ? 'email' : undefined; if (ch) state.slots.sendInfo = ch; }
  if ((proofAsk || infoAsk) && !earlyInfo) {
    const channel = /whatsapp/i.test(text) ? 'WhatsApp' : /\b(e-?mail|mail)\b/i.test(text) ? 'email' : undefined;
    const email = text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0];
    if (email) state.slots.email = email.toLowerCase();
    if (channel || infoAsk) { state.slots.sendInfo = channel ?? 'WhatsApp'; state.slots.requirements.push(`Asked for ${proofAsk ? 'examples / portfolio' : 'details'} on ${state.slots.sendInfo}`); }
    const how = state.slots.sendInfo === 'email' ? (state.slots.email ? `to ${state.slots.email}` : 'by email') : 'on WhatsApp to this number';
    const what = proofAsk ? 'the portfolio' : 'the details';
    if (state.slots.sendInfo === 'email' && !state.slots.email) { state.lastAsk = 'email'; state.stage = 'wrapup'; return { reply: `Sure — I’ll have ${owner} email ${what} over. What’s the best email for that?` }; }
    if (infoAsk && !proofAsk) {
      state.stage = 'closing'; state.lastAsk = 'info_followup';
      return { reply: `Sure — I’ll have ${owner} send the details ${how} today. If it looks useful, would a quick 15 minutes ${d1} or ${d2} help, or would you rather just reply when you’ve had a look?` };
    }
    const pf = prof.proof[0];
    state.stage = 'closing'; state.lastAsk = 'info_followup'; state.slots.sendInfo ??= 'WhatsApp';
    if (state.slots.proofAsked) return { reply: `Completely fair. ${isSolo(ctx.business) ? `${owner} is a real freelance developer — you can` : 'You can'} look at the work and talk to ${isSolo(ctx.business) ? 'him' : 'the team'} directly before you pay anything. The portfolio comes ${how} today. Sound fair?` };
    state.slots.proofAsked = true;
    return { reply: `Totally fair to ask — you should check before trusting anyone who calls you.${pf ? ` ${pf}` : ''} I’ll have ${owner} send ${/scam|fraud|legit|genuine|trust|know/i.test(text) ? 'the portfolio and a couple of past projects' : 'some examples of past work'} ${how} so you can see for yourself — no commitment. Does that work?` };
  }
  if (state.lastAsk === 'info_followup') {
    state.stage = 'ended';
    if (i.meeting || parts.hasDay) { state.stage = 'scheduling'; state.schedulingKind = 'meeting'; state.lastAsk = 'time'; state.slots.interest = 'yes'; }
    else return { reply: `Perfect — it’ll be with you today. ${bye}`, end: true };
  }

  // ---- "What is this about?" → the reason, plainly, then the problem menu ----
  if (/\b(what('?s| is) (this|it|the call) (about|regarding|for)|what do you (want|do|sell|offer)|why (are you|did you) (calling|call)|what is this|what'?s this|kis (baare|liye))\b/i.test(text)) {
    state.stage = 'discovery'; state.lastAsk = 'problem_menu';
    return { reply: `Sure — ${prof.reason}. ${problemMenu(prof)}` };
  }

  // ---- No website / only on Instagram: that IS the problem, so label it and quantify ----
  if (offerTypeFor(ctx.business)?.key === 'website' && /\b(no website|don'?t have (a |any )?website|do not have (a |any )?website|without (a )?website|(only|just) (on |through )?(instagram|facebook|insta|whatsapp|google maps)|website (hai )?nahi|website nahin)\b/i.test(text) && !state.slots.noWebsite) {
    state.slots.noWebsite = true; state.slots.pain = 'no website — only social media'; state.slots.pains.push(text.slice(0, 200));
    state.stage = 'discovery'; state.lastAsk = 'impact';
    return { reply: `Got it — so right now people can only find you on Instagram, and anyone searching Google for ${audienceFor(prof.audience).key === 'other' ? 'what you do' : 'a place like yours'} won’t see you at all. Roughly how many enquiries a month do you think you’re missing because of that?` };
  }

  // ---- They want to meet the owner/founder ----
  if (i.meetOwner && !i.optOut) {
    state.slots.meetingWith = 'owner'; state.slots.interest = 'yes';
    const at = parts.hasDay && parts.hasHour ? parseMeetingTime(text, zone) : undefined;
    if (at) return bookReply(ctx, state, at, 'meeting', zone);
    state.stage = 'scheduling'; state.schedulingKind = 'meeting'; state.lastAsk = 'time';
    return { reply: `Absolutely — I’ll set up a Google Meet with ${isSolo(ctx.business) ? ownerFirst(ctx.business) : 'our founder'} directly. What day and time work best for you?` };
  }

  // ---- A concrete time anywhere in the call = they’re agreeing to meet (or to a callback if that’s what we asked) ----
  if (parts.hasDay && parts.hasHour && !i.notInterested) {
    const at = parseMeetingTime(text, zone);
    if (at) {
      if (!callbackContext) state.slots.interest = 'yes';
      return bookReply(ctx, state, at, callbackContext ? 'callback' : 'meeting', zone);
    }
  }
  // Day but no time → ask for the time instead of guessing
  if ((state.stage === 'scheduling' || state.lastAsk === 'meeting_offer' || state.lastAsk === 'time' || callbackContext) && parts.hasDay && !parts.hasHour) {
    const cb = callbackContext || (i.busy && !i.meeting);
    state.slots.pendingDay = text; state.stage = 'scheduling'; state.schedulingKind ??= cb ? 'callback' : 'meeting'; state.lastAsk = cb ? 'callback_time' : 'time';
    const day = /tomorrow|\bkal\b/i.test(text) ? 'tomorrow' : 'that day';
    return { reply: cb ? `Sure, no problem — what time ${day} is good to call you?` : `Great — what time ${day} suits you? Morning or afternoon?` };
  }
  // Time but no day, with a day given earlier
  if (state.slots.pendingDay && parts.hasHour) {
    const at = parseMeetingTime(`${state.slots.pendingDay} ${text}`, zone);
    state.slots.pendingDay = undefined;
    if (at) return bookReply(ctx, state, at, state.schedulingKind ?? 'meeting', zone);
  }

  // "Not now — maybe in a couple of months"
  const timelineNotDeferral = /\b(within|by|in the next|over the next|budget|asap|soon)\b/i.test(text) || i.interested;
  if (i.later && !timelineNotDeferral && !i.optOut && !isCallbackTime(text) && state.stage !== 'scheduling') {
    const f = parseFollowUp(text, zone, ctx.business?.followUps?.nurtureDefaultDays ?? 45);
    state.slots.nurtureAt = f.at.toISOString(); state.slots.nurtureLabel = f.label;
    const okay = pick(state, ['Totally fair — timing is everything.', 'No problem at all, I get it.']);
    // One quick question before letting go, so the follow-up call is about the right thing.
    const prof0 = salesProfile(ctx);
    if (!state.slots.pain && prof0.pains.length >= 2) {
      state.lastAsk = 'nurture_pain'; state.stage = 'wrapup';
      return { reply: `${okay} I’ll check back around ${f.label}. Quick one before I go, so I call with the right thing — would ${prof0.pains[0].pain} or ${prof0.pains[1].pain} matter more?`, actions: [{ type: 'nurture', at: f.at, label: f.label }] };
    }
    state.stage = 'ended';
    return { reply: `${okay} I’ll check back in around ${f.label}. ${bye}`, end: true, actions: [{ type: 'nurture', at: f.at, label: f.label }] };
  }

  if (state.stage === 'scheduling') {
    if (i.deny || i.notInterested) { state.stage = 'ended'; return { reply: `No worries. I’ll send a short email with the details so you have it. ${bye}`, end: true }; }
    if (++state.schedulingTries >= 3) { state.stage = 'ended'; return { reply: `Tell you what — I’ll email you a couple of times to pick from. ${bye}`, end: true }; }
    state.lastAsk = state.schedulingKind === 'callback' ? 'callback_time' : 'time';
    return { reply: state.schedulingTries === 1 ? `Sure — what day and time work best? Like tomorrow at 11, or Thursday afternoon?` : `Just give me a day and a rough time and I’ll lock it in.` };
  }

  const exit = (): { reply: string; end: boolean; actions: EngineAction[] } => {
    state.stage = 'ended'; state.slots.interest = 'no';
    return { reply: `${pick(state, ['Totally understand — I won’t keep you.', 'No problem at all, I appreciate you hearing me out.'])} If anything changes, you’ve got our number. ${bye}`, end: true, actions: [{ type: 'not_interested' }] };
  };
  const close = () => { state.stage = 'closing'; state.lastAsk = 'meeting_offer'; return testDrive(ctx, d1, d2); };
  const pitch = (said: string) => {
    const bridge = painToOffer(ctx, state, `${said} ${state.slots.pain ?? ''}`, prof);
    const pf = state.slots.proofUsed ? undefined : relevantProof(prof, `${said} ${state.slots.pain ?? ''}`);
    const proof = pf ? ` ${pf}` : '';
    if (proof) state.slots.proofUsed = true;
    return `${bridge}${proof}`;
  };

  // ---- Answers to our own questions come first, so short replies are read in context ----
  if (state.lastAsk === 'checkback') {
    if (i.affirm && !i.deny) {
      const f = parseFollowUp('in a couple of months', zone, ctx.business?.followUps?.nurtureDefaultDays ?? 60);
      state.slots.nurtureAt = f.at.toISOString(); state.slots.nurtureLabel = f.label; state.stage = 'ended';
      return { reply: `Perfect — I’ll check back around ${f.label}. ${bye}`, end: true, actions: [{ type: 'nurture', at: f.at, label: f.label }] };
    }
    return exit();
  }
  if ((state.lastAsk === 'gap1' || state.lastAsk === 'gap2') && i.notInterested && !/nothing|works|fine|happy/i.test(text)) return exit();
  if (state.lastAsk === 'gap1') {
    state.lastAsk = 'gap2';
    if (text.split(/\s+/).length > 2) state.slots.requirements.push(`Likes about current setup: ${text.slice(0, 200)}`);
    return { reply: `${pick(state, ['Makes sense.', 'Nice, that’s a big one.', 'Yeah, that matters.'])} And if you could change one thing about it, what would it be?` };
  }
  if (state.lastAsk === 'gap2') {
    if (i.nothingElse || i.deny || /\b(nothing|not really|it'?s (fine|great|good)|happy)\b/i.test(text)) {
      state.lastAsk = 'checkback';
      return { reply: `Honestly, that’s great to hear — sounds like you’re in good hands. Mind if I check back in a couple of months, just in case anything changes?` };
    }
    state.slots.pains.push(text.slice(0, 200));
    return { reply: `${pitch(text)} ${close()}` };
  }
  if (state.lastAsk === 'reframe_permission') {
    if (i.deny || i.notInterested) return exit();
    state.stage = 'discovery'; state.lastAsk = 'problem_menu';
    return { reply: `Thanks — I’ll be quick. ${problemMenu(prof)}` };
  }
  if (state.lastAsk === 'reframe' && !classifyObjection(text)) {
    if (/\b(priority|timing|right now|not now|bad time of year|season|busy)\b/i.test(text)) {
      state.lastAsk = 'checkback';
      return { reply: `That’s fair — timing is everything. Mind if I check back in a couple of months when things calm down?` };
    }
    if (i.deny || i.notInterested) return exit();
    state.slots.requirements.push(text.slice(0, 300));
    return { reply: `${pitch(text)} ${close()}` };
  }

  if (i.busy && !/busy season|busy time of year/i.test(text)) {
    state.stage = 'scheduling'; state.schedulingKind = 'callback'; state.lastAsk = 'callback_time';
    if (parts.hasDay && !parts.hasHour) { state.slots.pendingDay = text; return { reply: `Sure, no problem — what time ${/tomorrow|\bkal\b/i.test(text) ? 'tomorrow' : 'that day'} is good to call you?` }; }
    return { reply: pick(state, [`Oh — no worries at all. When’s a better time to catch you?`, `Totally get it. When would be a better time for a quick call back?`]) };
  }

  // ---- Objections: agree → get them talking → low-pressure next step. One honest attempt each. ----
  const obj = classifyObjection(text);
  if (obj) {
    const r = handleObjection(ctx, state, obj, text, prof, d1, d2);
    if (r === 'exit') return exit();
    return { reply: r };
  }

  if (state.stage === 'consent') {
    if (i.notInterested || (i.deny && !i.affirm && !i.question)) {
      if (state.objectionCount++ >= 1) return exit();
      state.objections.push(text.slice(0, 200)); state.lastAsk = 'reframe_permission';
      return { reply: pick(state, [`Totally fair — you weren’t expecting my call. Can I ask one quick question, and if it’s not relevant I’ll let you go?`, `Fair enough — I did just call out of the blue. One quick question, and if it’s not for you, I’ll let you get back to it. Okay?`]) };
    }
    state.stage = 'discovery'; state.lastAsk = 'problem_menu';
    if (i.question || i.price) {
      const ans = matchObjection(ctx, text) ?? (await kbAnswer(ctx, text));
      return { reply: `${ans ? `Good question — ${ans}` : valueProp(ctx)} ${problemMenu(prof)}` };
    }
    return { reply: `${pick(state, ['Appreciate it', 'Thanks', 'Great, thank you'])}${name ? ', ' + name : ''}. ${problemMenu(prof)}` };
  }

  if (i.notInterested || (i.deny && state.lastAsk === 'meeting_offer')) {
    if (state.objectionCount++ >= 1) return exit();
    state.objections.push(text.slice(0, 200));
    const custom = matchObjection(ctx, text);
    if (custom) { state.stage = 'closing'; state.lastAsk = 'meeting_offer'; return { reply: `Yeah, I hear that. ${custom} Would it be worth a quick 15 minutes to see for yourself?` }; }
    state.lastAsk = 'reframe';
    return { reply: pick(state, [`Totally fair. Can I ask — is it that you’ve already got this handled, or it’s just not a priority right now?`, `No problem. Just so I understand — is it the timing, or does it not sound like a fit?`]) };
  }

  if ((i.meeting && !i.question) || ((i.affirm || i.interested) && state.lastAsk === 'meeting_offer' && !i.question && !i.price)) {
    state.slots.interest = 'yes'; state.stage = 'scheduling'; state.schedulingKind = 'meeting'; state.lastAsk = 'time';
    return { reply: `Love it. Does ${d1} or ${d2} work better — and morning or afternoon?` };
  }

  const answeringUs = state.stage === 'discovery' && (state.lastAsk === 'problem_menu' || state.lastAsk === 'impact') && !/\?/.test(text) && !i.price;
  if ((i.question || i.price) && !answeringUs) {
    const howItWorks = /how (does|would|will) (it|this|that) work|what('?s| is) the process|how do (you|we) (start|begin)/i.test(text);
    const ans = howItWorks ? '' : matchObjection(ctx, text) ?? (await kbAnswer(ctx, text)) ?? '';
    if (!ans) {
      state.slots.unknownQs = (state.slots.unknownQs ?? 0) + 1; state.slots.requirements.push(`Asked: ${text.slice(0, 200)}`);
      if (howItWorks) {
        state.slots.unknownQs--; state.slots.requirements.pop();
        const items: any[] = [...(ctx.business.products ?? []), ...(ctx.business.services ?? [])];
        const it = items.find((p) => p.name === state.slots.offered[0]) ?? bestOffer(ctx, `${text} ${state.slots.pain ?? ''}`);
        state.stage = 'closing'; state.lastAsk = 'meeting_offer';
        return { reply: `Simple — ${owner === 'our team' ? 'we' : owner} look${owner === 'our team' ? '' : 's'} at what you have today on a quick 15-minute call, then ${it ? `${it.name.toLowerCase()} is planned around what you need` : 'you get a clear plan and price'}, no obligation. ${d1[0].toUpperCase() + d1.slice(1)} or ${d2}?` };
      }
      state.stage = 'closing'; state.lastAsk = 'meeting_offer';
      if (state.slots.unknownQs > 1) return { reply: `I’ve noted that down so ${owner} gives you a proper answer rather than me guessing. Want ${isSolo(ctx.business) ? 'him' : 'them'} to WhatsApp you, or would a quick 15-minute call ${d1} or ${d2} be easier?` };
      return { reply: `Good question — I don’t want to guess and give you the wrong answer. That’s exactly what ${owner === 'our team' ? 'the specialist' : owner} covers. Worth 15 minutes on Google Meet, ${d1} or ${d2}?` };
    }
    if (state.stage === 'discovery' && !state.slots.pain) {
      const heard = state.messages.some((m) => m.role === 'assistant' && /one of (three|two) things/.test(m.content));
      state.lastAsk = 'problem_menu';
      return { reply: `${ans} ${heard ? 'So of those things I mentioned — which one’s the bigger headache for you?' : problemMenu(prof)}` };
    }
    state.stage = 'closing'; state.lastAsk = 'meeting_offer';
    return { reply: `${ans} ${testDrive(ctx, d1, d2)}` };
  }

  if (state.stage === 'discovery') {
    if (text.split(/\s+/).length >= 2) state.slots.requirements.push(text.slice(0, 300));
    // They picked (or described) a problem → label it, then quantify — unless they already gave a number.
    if (state.lastAsk === 'problem_menu' || state.lastAsk === 'discovery') {
      const good = /\b(good shape|we'?re (good|fine|ok|okay)|none (of (them|those))?|not really|all good|no problems?)\b/i.test(text) || (i.deny && text.split(/\s+/).length <= 3);
      if (good && !state.slots.pain) {
        state.lastAsk = 'discovery'; state.discoveryStep = Math.max(state.discoveryStep, 1);
        return { reply: `Good to hear — sounds like you’ve got things running smoothly. ${DISCOVERY[0](ctx)}` };
      }
      const pain = matchPain(prof, text);
      const e0 = empathy(text);
      const feel = e0 && (!pain || sameTopic(e0, pain.pain)) ? e0 : undefined;
      if (pain || e0) {
        state.slots.pain = (pain?.pain ?? text).slice(0, 160); state.slots.pains.push(text.slice(0, 200));
        const f = extractFrequency(text);
        if (f) return { reply: `${impactLine(f)} ${pitch(text)} ${close()}` };
        state.lastAsk = 'impact';
        const label = feel ?? (pain!.want ? `Got it — so ${pain!.pain} would make a real difference.` : `Sounds like ${pain!.pain} is the real headache.`);
        return { reply: `${label} ${prof.impactQ}` };
      }
    }
    if (state.lastAsk === 'impact') {
      const f = extractFrequency(text);
      return { reply: `${f ? impactLine(f) : pick(state, ['Yeah, that adds up fast.', 'That adds up over a month.'])} ${pitch(text)} ${close()}` };
    }
    if (state.discoveryStep < DISCOVERY.length && !(i.interested && state.discoveryStep >= 2)) {
      const bridge = empathy(text) ?? ack(ctx, state);
      if (empathy(text)) state.slots.pain ??= text.slice(0, 160);
      state.lastAsk = 'discovery';
      return { reply: `${bridge} ${DISCOVERY[state.discoveryStep++](ctx)}` };
    }
    return { reply: `${pitch(text)} ${close()}` };
  }

  if (state.stage === 'closing') {
    if ((i.affirm || i.interested) && !i.question && !i.price) { state.slots.interest = 'yes'; state.stage = 'scheduling'; state.schedulingKind = 'meeting'; state.lastAsk = 'time'; return { reply: `Great. ${d1[0].toUpperCase() + d1.slice(1)} or ${d2} — and morning or afternoon?` }; }
    if (i.deny) return exit();
    state.lastAsk = 'meeting_offer';
    // Already pitched: acknowledge what they added (timeline, budget, detail) and re-ask simply — never repeat the pitch.
    if (state.slots.offered.length) {
      const tl = extractTimeline(text), bud = extractBudget(text);
      const heard = tl || bud ? `Good to know — ${[tl, bud && `around ${bud}`].filter(Boolean).join(', ')} works well for this.` : pick(state, ['Got it, that helps.', 'Makes sense.', 'Okay, noted.']);
      return { reply: `${heard} Shall we grab 15 minutes ${d1} or ${d2} to map it out?` };
    }
    return { reply: `${pitch(text)} ${testDrive(ctx, d1, d2)}` };
  }

  state.stage = 'ended';
  return { reply: bye, end: true };
}

/** The ask: a free 15-minute look (a “test drive”), with two concrete days so saying yes is easy. */
function testDrive(ctx: EngineContext, d1: string, d2: string) {
  const who = ctx.lead?.companyName ? ` for ${ctx.lead.companyName}` : '';
  return formal(ctx)
    ? `Would a 15-minute Google Meet be worthwhile, to see how it would work${who}? I have ${d1} or ${d2} — which suits you better?`
    : `Worth a quick 15 minutes on Google Meet to see it on your own setup? ${d1[0].toUpperCase() + d1.slice(1)} or ${d2}?`;
}

function sourceLine(lead: any) {
  const s = lead?.source;
  if (s === 'csv_import') return 'your details were on a contact list our team uploaded';
  if (s === 'manual') return 'someone on our team added your business to our list';
  return 'your business is listed publicly online — that’s where we found the number';
}

/** Returns the reply, or 'exit' when this is the second no and we should stop selling. */
function handleObjection(ctx: EngineContext, state: ConversationState, kind: ObjectionKind, text: string, prof: ReturnType<typeof salesProfile>, d1: string, d2: string): string | 'exit' {
  const custom = matchObjection(ctx, text);
  state.objections.push(text.slice(0, 200));
  const toDiscovery = () => { if (state.stage === 'consent') state.stage = 'discovery'; };
  switch (kind) {
    case 'how_number':
      state.lastAsk = 'permission';
      return `Fair question — ${sourceLine(ctx.lead)}. If you’d rather we didn’t call, I’ll take you off our list right now. Otherwise, can I take 30 seconds to explain why I called?`;
    case 'sales_call':
      state.lastAsk = 'permission';
      return formal(ctx) ? `It is, yes — I won’t pretend otherwise. Give me 30 seconds, and if it isn’t relevant, just say so. Fair?` : `Ha — it is, I won’t pretend otherwise. Give me 30 seconds, and if it’s not relevant you can tell me to get lost. Fair?`;
    case 'who_is_this':
      state.lastAsk = 'permission';
      return `It’s ${ctx.agent?.name ?? 'Aria'}, an AI assistant ${isSolo(ctx.business) ? `working with ${ownerFirst(ctx.business)}` : `with ${ctx.business.name}`} — ${prof.reason}. Got 30 seconds?`;
    case 'send_info': {
      toDiscovery();
      if (state.slots.pain || prof.pains.length < 2) { state.stage = 'closing'; state.lastAsk = 'meeting_offer'; return `Happy to send it over. Honestly though, an email can’t show it on your own setup — would 15 minutes ${d1} or ${d2} be easier?`; }
      state.lastAsk = 'problem_menu';
      return `Happy to. So I send something actually useful — which matters more right now: ${prof.pains[0].pain}, or ${prof.pains[1].pain}?`;
    }
    case 'has_solution': {
      if (state.objectionCount++ >= 1 && (detectIntents(text).notInterested)) return 'exit';
      toDiscovery();
      const tool = namedTool(text); if (tool) state.slots.tool = tool;
      // “old / clunky / basic” is a buying signal — go straight to what bothers them.
      if (/\b(old|outdated|clunky|basic|ancient|slow|annoying|pain)\b/i.test(text)) { state.lastAsk = 'gap2'; return `${pick(state, ['Got it, an older setup.', 'Ah, an older system — fair enough.'])} What’s the most annoying thing about it day to day?`; }
      state.lastAsk = 'gap1';
      if (custom) return `${custom} Out of curiosity, what do you like most about ${tool ?? 'what you have now'}?`;
      return `${pick(state, ['Nice — sounds like you’re ahead of most.', 'Oh good, so you’ve already got something in place.'])} What do you like most about ${tool ?? 'it'}?`;
    }
    case 'no_budget': {
      state.stage = 'closing'; state.lastAsk = 'meeting_offer';
      if (custom) { if (state.objectionCount++ >= 1) return 'exit'; return `Yeah, I hear that. ${custom} Would it be worth a quick 15 minutes to see for yourself?`; }
      const entry = priceAnswer(ctx, 'cheapest');
      if (state.objectionCount++ === 0) return `Totally get it — nobody wants another bill. The 15-minute look is free, and you’d see straight away whether it pays for itself. If it doesn’t, no hard feelings. ${d1[0].toUpperCase() + d1.slice(1)} or ${d2}?`;
      if (entry && !state.slots.entryPriceSaid) { state.slots.entryPriceSaid = true; return `Makes sense for a smaller firm. For what it’s worth, ${entry.replace(/\.$/, '')} — and ${isSolo(ctx.business) ? ownerFirst(ctx.business) : 'we'} can start small and grow it later. Worth a quick look ${d1} or ${d2}, no pressure?`; }
      return 'exit';
    }
    case 'partner':
      state.stage = 'closing'; state.lastAsk = 'meeting_offer';
      return `Makes total sense — that’s a decision you’d make together. Want to bring them on the Google Meet too? I’ve got ${d1} or ${d2}.`;
    case 'too_small': {
      state.stage = 'closing'; state.lastAsk = 'meeting_offer';
      const p = (state.slots.pain ?? prof.pains[0]?.pain ?? 'this');
      return `Fair — though smaller teams often feel ${p.length < 60 ? p : 'this'} the most, with no front desk to catch it. Worth 15 minutes ${d1} or ${d2} to see if it fits your size?`;
    }
  }
}

export function systemPrompt(ctx: EngineContext, state: ConversationState, knowledge: string) {
  const { business: b, agent: a, lead, campaign } = ctx;
  const offer = [...(b.products ?? []), ...(b.services ?? [])].map((p: any) => `${p.name}${p.price ? ` (${p.price})` : ''}: ${p.description ?? ''}`).join('; ');
  return `You are ${a?.name ?? 'Aria'}, ${isSolo(b) ? `an AI sales assistant working for ${b.ownerName ?? 'a freelancer'} (a freelancer — say "${ownerFirst(b)}" or "I", never invent a company name)` : `${a?.title ?? 'Senior Account Executive'} at ${b.name}`}, on a live PHONE call.
Background (shapes HOW you sell — never recite it as a personal claim): ${a?.experience ?? 'a seasoned B2B closer'}.
You know exactly what you sell: ${b.description ?? ''} Offer: ${offer || 'see KNOWLEDGE'}. Ideal customer: ${b.targetAudience ?? 'n/a'}.
Objective: ${campaign?.objective ?? a?.objective ?? 'qualify and book a 15-minute meeting with a specialist'}.
${campaign?.script ? `Campaign talking points: ${campaign.script}\n` : ''}${a?.instructions ? `Extra instructions: ${a.instructions}\n` : ''}
${playbookPrompt(salesProfile(ctx), tz(ctx))}
HOW TO SELL: first understand their situation (how they do it today, what it costs them). Then connect THEIR words to the ONE most relevant offer ("you said X — that's exactly what Y fixes"). Never give generic or unrelated answers; if you don't understand, ask a short clarifying question. If they want to meet the owner/founder, ask for a specific day and time and book it ("book_meeting", meetings are on Google Meet).
HOW TO SOUND: like a relaxed, confident top-performing salesperson on the phone, not a chatbot. ${a?.style === 'formal' ? 'Polite and professional.' : 'Warm, casual, contractions, the occasional "yeah", "totally", "honestly".'} 1–2 short sentences per turn (under 35 words), one question at a time, mirror their words, never lists or markdown, never say "as an AI" unless asked. Lead with curiosity, then value, then a clear ask.
HONESTY RULES (non-negotiable): you already said you're an AI assistant in the opener; if asked whether you're a bot/AI/real person, say yes you're an AI assistant on the sales team, then carry on naturally. Never claim to be human. Only state facts from KNOWLEDGE; never invent prices, discounts, customers or guarantees.
OUTCOMES: books meeting → "book_meeting"; asks to be called at a specific time soon → "callback"; "not now / in a few months / next quarter" → "nurture" (time_text = their words); clearly not interested after one gentle objection-handle → "not_interested"; asks not to be called → "opt_out"; wants a person → "transfer".
Prospect: ${lead?.contactName ?? 'unknown'}${lead?.designation ? ', ' + lead.designation : ''} at ${lead?.companyName ?? 'their company'}${lead?.industry ? ' (' + lead.industry + ')' : ''}${lead?.location?.city ? ', ' + lead.location.city : ''}.
Known so far: ${JSON.stringify(state.slots)}. Your last question: ${state.lastAsk ?? 'opening'} (interpret short answers like "no thanks" or "tomorrow" in that context — "no thanks" after "anything else?" means nothing else, NOT not interested; a day without a time → ask for the time).
Objection playbook: ${(a?.objectionHandling ?? []).map((o: any) => `"${o.objection}" → ${o.response}`).join(' | ') || 'none'}
KNOWLEDGE:
${knowledge || '(no matching knowledge)'}
Respond ONLY as JSON: {"reply": string, "action": "none"|"book_meeting"|"callback"|"nurture"|"not_interested"|"transfer"|"end"|"opt_out", "time_text"?: string, "interest"?: "yes"|"no"|"unknown", "requirement"?: string, "budget"?: string, "timeline"?: string}`;
}

async function llmTurn(ctx: EngineContext, state: ConversationState, text: string) {
  const llm = getLLM();
  if (!llm) return null;
  const chunks = await retrieve(ctx.business._id, text, 3, 0.1);
  const knowledge = chunks.map((c) => `- ${c.text.slice(0, 700)}`).join('\n');
  const history: ChatMessage[] = state.messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
  const r = await llm.chat([{ role: 'system', content: systemPrompt(ctx, state, knowledge) }, ...history], { json: true, temperature: 0.6, maxTokens: 220 });
  const out = safeJson(r.content);
  if (!out.reply) return null;
  return out as { reply: string; action?: string; time_text?: string; interest?: string; requirement?: string; budget?: string; timeline?: string };
}

/** Process one customer utterance and produce the agent's reply + side-effect actions. */
export async function respond(ctx: EngineContext, prev: ConversationState, utterance: string): Promise<TurnResult> {
  const state: ConversationState = structuredClone(prev);
  const text = (utterance ?? '').trim();
  state.turns++;
  state.messages.push({ role: 'user', content: text || '(silence)', at: Date.now() });
  const i = detectIntents(text);
  const actions: EngineAction[] = [];
  const done = (reply: string, end = false): TurnResult => {
    state.messages.push({ role: 'assistant', content: reply, at: Date.now() });
    if (end) state.stage = 'ended';
    return { reply, end, actions, state };
  };
  const zone = tz(ctx);

  // ---- Deterministic compliance guards (always first, never delegated to the LLM) ----
  if (i.optOut) {
    state.optOut = true; state.slots.interest = 'no'; state.endReason = 'opt_out';
    actions.push({ type: 'opt_out' });
    return done(`Of course — I’ve taken your number off our list, you won’t hear from us again. Sorry for the interruption, have a good day.`, true);
  }
  if (state.stage === 'consent' && needsRecordingConsent(ctx) && state.recordingConsent === undefined) {
    const refuse = /(don't|do not|dont|no) (record|recording)|without recording|not (be )?recorded/i.test(text);
    state.recordingConsent = !refuse && !i.deny ? true : refuse ? false : undefined;
    if (state.recordingConsent !== undefined) actions.push({ type: 'recording_consent', granted: state.recordingConsent });
  }
  if (i.wantsHuman && !i.asksIfAI) {
    const num = transferNumber(ctx);
    if (num) { state.transfer = true; state.endReason = 'transferred'; actions.push({ type: 'transfer', number: num }); return done(`Absolutely — let me grab someone from the team for you. One sec.`, true); }
    state.stage = 'scheduling'; state.schedulingKind = 'callback';
    return done(`Sure thing — the team’s tied up right this minute, but I can have someone call you back. What time’s good?`);
  }
  if (i.asksIfAI) {
    const cont = state.stage === 'consent' ? ' Do you have a quick minute?' : ' Happy to keep going if that’s okay?';
    return done(`${pick(state, ['Ha, good catch —', 'Yep —', 'I am, yes —'])} I’m an AI assistant ${isSolo(ctx.business) ? `working with ${ownerFirst(ctx.business)}. Anything we set up goes straight to ${ownerFirst(ctx.business)}.` : `on the ${ctx.business.name} sales team. Anything we set up goes to a real specialist.`}${cont}`);
  }
  const maxTurns = Math.max(6, (ctx.agent?.maxCallMinutes ?? 8) * 3);
  if (state.turns > maxTurns) { state.endReason = 'max_duration'; return done(`I’ve taken enough of your time — I’ll send the details over by email. Thanks so much!`, true); }

  captureSlots(state, text, i);

  // ---- LLM path (with deterministic fallback) ----
  try {
    const out = await llmTurn(ctx, state, text);
    if (out) {
      if (out.interest === 'yes' || out.interest === 'no') state.slots.interest = out.interest;
      if (out.requirement) state.slots.requirements.push(String(out.requirement).slice(0, 300));
      if (out.budget) state.slots.budget = String(out.budget);
      if (out.timeline) state.slots.timeline = String(out.timeline);
      if (state.stage === 'consent') state.stage = 'discovery';
      if (/anything else/i.test(out.reply)) state.lastAsk = 'anything_else';
      else if (/(what|which) (day|time)/i.test(out.reply)) state.lastAsk = 'time';
      else if (/\?\s*$/.test(out.reply)) state.lastAsk = 'discovery';
      switch (out.action) {
        case 'opt_out':
          state.optOut = true; state.endReason = 'opt_out'; actions.push({ type: 'opt_out' }); return done(out.reply, true);
        case 'not_interested':
          state.slots.interest = 'no'; actions.push({ type: 'not_interested' }); return done(out.reply, true);
        case 'nurture': {
          const f = parseFollowUp(out.time_text ?? text, zone, ctx.business?.followUps?.nurtureDefaultDays ?? 45);
          state.slots.nurtureAt = f.at.toISOString(); state.slots.nurtureLabel = f.label;
          actions.push({ type: 'nurture', at: f.at, label: f.label });
          return done(out.reply, true);
        }
        case 'book_meeting': case 'callback': {
          const tt = out.time_text ?? text;
          const tp = timeParts(tt);
          const at = tp.hasDay && tp.hasHour ? parseMeetingTime(tt, zone) : undefined;
          if (at) {
            const kind = out.action === 'callback' ? 'callback' : 'meeting';
            state.slots.meetingAt = at.toISOString(); state.slots.meetingKind = kind; state.stage = 'wrapup'; state.lastAsk = 'anything_else';
            actions.push({ type: 'book', at, kind, display: formatMeetingTime(at, zone), with: state.slots.meetingWith ?? 'specialist' });
            return done(out.reply, kind === 'callback');
          }
          state.stage = 'scheduling'; state.lastAsk = 'time';
          return done(/\?\s*$/.test(out.reply) ? out.reply : `${out.reply} What day and time work for you?`);
        }
        case 'transfer': {
          const num = transferNumber(ctx);
          if (num) { state.transfer = true; actions.push({ type: 'transfer', number: num }); return done(out.reply, true); }
          return done(out.reply);
        }
        case 'end':
          return done(out.reply, true);
        default:
          return done(out.reply);
      }
    }
  } catch { /* fall through to rules */ }

  const r = await ruleTurn(ctx, state, text, i);
  actions.push(...(r.actions ?? []));
  return done(r.reply, !!r.end);
}

/** Start a conversation: returns opening line + initial state. */
export function start(ctx: EngineContext) {
  const state = newState();
  const reply = openingMessage(ctx);
  state.messages.push({ role: 'assistant', content: reply, at: Date.now() });
  return { reply, state };
}
