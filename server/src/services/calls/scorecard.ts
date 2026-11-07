import { detectIntents } from '../agent/nlu.js';
import { classifyObjection } from '../agent/playbook.js';

/**
 * Call scorecard — grades a conversation the way a sales manager reviews a rep's call, with a coaching tip
 * for every missed step. Works on any transcript (our engine, Vapi, or a human rep).
 */
export interface Turn { who: 'agent' | 'customer'; text: string }
export interface ScoreCheck { key: string; label: string; passed: boolean; points: number; tip?: string }
export interface Scorecard { score: number; grade: 'A' | 'B' | 'C' | 'D'; checks: ScoreCheck[]; talkRatio: number; agentQuestions: number; longestTurnWords: number }

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const PAIN = /(no.?shows?|forget|miss(ed|ing)? calls?|phone|manual|spreadsheet|by hand|slow|quiet|empty|dead|fees?|expensive|clunky|hard to|struggl|problem|issue|headache|killing us|losing|waste|too much time)/i;

export function scoreCall(turns: Turn[], outcome: { booked?: boolean; callback?: boolean; nurture?: boolean; optOut?: boolean; notInterested?: boolean } = {}): Scorecard {
  const agent = turns.filter((t) => t.who === 'agent');
  const cust = turns.filter((t) => t.who === 'customer');
  const opener = agent[0]?.text ?? '';
  const later = agent.slice(1).map((t) => t.text);
  const all = later.join(' ');
  const qs = later.filter((t) => /\?/.test(t));
  const discoveryQs = qs.filter((t) => /\b(how|what|which|any of (that|those)|sound familiar|how often|how many|why|tell me)\b/i.test(t) && !/(what day|which (day|is better)|what time|morning or afternoon)/i.test(t));
  const painIdx = cust.findIndex((t) => PAIN.test(t.text));
  const objections = cust.map((t, i) => ({ i, kind: classifyObjection(t.text) ?? (detectIntents(t.text).notInterested ? 'not_interested' : undefined) })).filter((o) => o.kind);
  const turnAfter = (custIdx: number) => { const pos = turns.indexOf(cust[custIdx]); return turns.slice(pos + 1).find((t) => t.who === 'agent')?.text ?? ''; };
  const handled = objections.length === 0 || objections.slice(0, 1).every((o) => { const r = turnAfter(o.i); return /\?/.test(r) || /check back|you’ve got our number|off our list/i.test(r); });
  const pushy = objections.length >= 3 && !outcome.optOut && !/you’ve got our number|won’t keep you/i.test(agent.at(-1)?.text ?? '');
  const agentWords = agent.reduce((n, t) => n + words(t.text), 0);
  const custWords = cust.reduce((n, t) => n + words(t.text), 0);
  const talkRatio = agentWords + custWords ? Math.round((agentWords / (agentWords + custWords)) * 100) : 0;
  const respected = !!outcome.optOut && /off our list|won’t hear from us/i.test(agent.at(-1)?.text ?? '');
  const nextStep = !!(outcome.booked || outcome.callback || outcome.nurture) || respected;

  const shortSteered = cust.length <= 3 && painIdx < 0 && (outcome.callback || outcome.nurture || outcome.optOut || outcome.notInterested);
  const checks: ScoreCheck[] = [
    { key: 'disclosure', label: 'Said it’s an AI assistant up front', points: 10, passed: /\b(ai|virtual|automated) assistant\b/i.test(opener), tip: 'The first line must say it’s an AI assistant — it’s the law in many places and builds trust.' },
    { key: 'reason', label: 'Gave the reason for the call early', points: 10, passed: /reason i’m calling|reason i'm calling|calling (about|because)|reaching out (about|because)/i.test(opener), tip: 'State why you’re calling in the first 15 seconds — it roughly doubles the chance of a meeting.' },
    { key: 'no_bad_time', label: 'Asked for a short slice of time (not “is this a bad time?”)', points: 5, passed: !/bad time|okay time|good time/i.test(opener), tip: 'Avoid “did I catch you at a bad time?” — ask for 30 seconds instead.' },
    { key: 'discovery', label: 'Asked discovery questions before pitching', points: 15, passed: discoveryQs.length >= (shortSteered ? 1 : 2) || (discoveryQs.length >= 1 && painIdx >= 0 && painIdx <= 1), tip: 'Ask how they handle it today and what it costs them before talking about the product.' },
    { key: 'pain', label: 'Found a real problem in the customer’s words', points: 10, passed: painIdx >= 0, tip: 'Use a “problem menu”: name the 2–3 problems peers usually have and let them pick.' },
    { key: 'impact', label: 'Quantified the impact (how often / how many)', points: 10, passed: /how often|how many|a week|a month/i.test(all), tip: 'Ask how often the problem happens, then say their number back (“so ~5 a week — 20 a month”).' },
    { key: 'tailored', label: 'Pitched the one offer that fixes THEIR problem', points: 15, passed: painIdx >= 0 && /(exactly what|is for|fixes|handles|built for)/i.test(all), tip: 'Connect their words to one specific product — not a feature list.' },
    { key: 'objections', label: 'Handled objections with a question, not an argument', points: 10, passed: handled && !pushy, tip: pushy ? 'Three or more pushes after a no feels like pressure — one honest attempt, then exit warmly.' : 'Agree first, then ask a question to get them talking (e.g. “is it the timing, or the fit?”).' },
    { key: 'next_step', label: 'Ended with a clear next step (or a respectful exit)', points: 15, passed: nextStep || (!!outcome.notInterested && /you’ve got our number|won’t keep you/i.test(agent.at(-1)?.text ?? '')), tip: 'Close for a specific time (“Tuesday or Wednesday?”). If it’s a no, ask permission to check back later.' },
  ];
  // A no-conversation call (voicemail / instant hang-up) shouldn't be graded on discovery.
  // Short calls the customer steered (call me later / not now / stop calling) are graded on the opener and how it ended.
  const scoreable = cust.length === 0 ? checks.filter((c) => ['disclosure', 'reason', 'no_bad_time'].includes(c.key))
    : shortSteered ? checks.filter((c) => ['disclosure', 'reason', 'no_bad_time', 'objections', 'next_step', ...(cust.length >= 2 ? ['discovery'] : [])].includes(c.key)) : checks;
  const max = scoreable.reduce((n, c) => n + c.points, 0);
  const got = scoreable.reduce((n, c) => n + (c.passed ? c.points : 0), 0);
  const score = Math.round((got / max) * 100);
  const longestTurnWords = Math.max(0, ...later.map(words));
  return { score, grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D', checks: scoreable.map((c) => (c.passed ? { ...c, tip: undefined } : c)), talkRatio, agentQuestions: qs.length, longestTurnWords };
}
