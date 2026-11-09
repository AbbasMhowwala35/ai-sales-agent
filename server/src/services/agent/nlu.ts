import { DateTime } from 'luxon';
import { clock } from '../../lib/clock.js';

/** Deterministic intent detection. Compliance-critical intents (opt-out, AI identity, human request) never depend on an LLM. */
const has = (t: string, re: RegExp) => re.test(t);

export function detectIntents(text: string) {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'")} `;
  return {
    optOut: has(t, /(do not|don't|dont|never|stop) (call|calling|contact|ring)|remove (me|my number)|take me off|unsubscribe|opt[- ]?out|lose my number|add me to (your )?(dnc|do not call)|stop calling/),
    wantsHuman: has(t, /(speak|talk|connect|transfer).{0,20}(human|person|someone|representative|agent|manager|sales ?(person|rep|team))|real person|human being/),
    asksIfAI: has(t, /(are|r) (you|u) (a |an )?(robot|bot|ai|machine|human|real|computer|recording)|is this (a |an )?(robot|bot|ai|recording|automated|real person|human)|(am i|are we) (talking|speaking|chatting) (to|with) (a |an )?(robot|bot|machine|computer|ai|real person|human|recording)|(robot|bot|machine|ai|computer) (hai|ho|h)\b|kya (aap|tum|ye) (robot|bot|ai|machine|insaan)/),
    affirm: has(t, /\b(yes|yeah|yep|yup|sure|ok|okay|alright|go ahead|of course|please do|sounds good|why not|absolutely|definitely|haan|han|ha ji|haan ji|ji haan|boliye|bolo|batao|theek hai|thik hai|chalo|go on|tell me|i can|that works|works for me|fine)\b/),
    deny: has(t.replace(/\bno[- ]?shows?\b/g, ' '), /\b(no|nope|nah|not really|not now|don't think so|nahi|nahin|nhi|mat karo)\b/),
    busy: has(t, /\b(busy|in a meeting|driving|call (me )?(back|later)|not a good time|bad time|later|baad (me|mein|main)|kal baat|baat karte|abhi nahi|abhi time nahi)\b/),
    notInterested: has(t, /(not interested|no interest|don't need|dont need|we('re| are) (good|fine|covered|happy)|already have|no thanks|no thank you|not looking)/),
    price: has(t, /(price|pricing|cost|how much|charges?|fees?|quote|rate|expensive|cheap|budget|afford|kitna|kitne|kharcha|kharch|keemat|kimat|paisa|paise)/),
    question: has(t, /\?|^\s*(so |and |but |ok(ay)? |well )?(what|how|why|which|when|where|who|do you|can you|does it|is there|is it|are there|tell me about|explain)\b|\b(tell me about|explain|how much|what is|what's|how does|how do you|can you|do you (offer|have|do))\b/),
    interested: has(t, /(interested|sounds (good|great|interesting)|tell me more|i'd like|we need|we are looking|looking for|we want|keen|curious|could use|want to know|send (me )?details)/),
    meeting: has(t, /(meet|meeting|demo|appointment|schedule|book|slot|call me|catch up|discuss further)/),
    goodbye: has(t, /\b(bye|goodbye|that's all|thats all|nothing else|have a good day)\b/),
    meetOwner: has(t, /(meet|speak|talk|call|chat).{0,25}(owner|founder|ceo|boss|business owner|someone senior|the head|decision maker|your manager)|(owner|founder|ceo).{0,15}(meet|call|available)/),
    nothingElse: has(t, /^\s*(no|nope|nah|no thanks|no thank you|nothing|that'?s it|that'?s all|all good|i'?m good|we'?re good|not really|nothing else|no,? that'?s (it|all|fine))\W*$/),
    later: has(t, /(not (right )?now|maybe later|not at the moment|not this (month|quarter|year)|in a (few|couple of?) (weeks|months)|in (\d+|one|two|three|four|six) (weeks?|months?)|next (month|quarter|year|season)|after (the )?(holidays?|season|new year|christmas|summer|busy season)|reach out (again )?(later|in)|circle back|check back|follow up (in|later)|call (me )?(back )?(in|next) (a few |\d+ |two |three )?(weeks?|months?|quarter))/),
  };
}
export type Intents = ReturnType<typeof detectIntents>;

export function extractBudget(text: string) {
  const m = text.match(/(?:₹|rs\.?|inr|\$|usd|aed|£|€)\s?[\d,.]+\s?(?:k|lakh|lakhs|lac|crore|cr|million|m)?|\b[\d,.]+\s?(?:k|lakh|lakhs|lac|crore|cr|thousand|million)\b(?:\s?(?:rupees|dollars|per month|a month|monthly|per year|annually))?/i);
  return m?.[0]?.trim();
}

export function extractTimeline(text: string) {
  const m = text.match(/\b(asap|immediately|right away|this (week|month|quarter|year)|next (week|month|quarter|year)|in (a|one|two|three|\d+) (weeks?|months?)|within (a|\d+) (weeks?|months?)|by (january|february|march|april|may|june|july|august|september|october|november|december)|q[1-4])\b/i);
  return m?.[0];
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Parse a natural-language meeting time ("tomorrow at 3 pm", "Monday 11am", "next week") in the given timezone. */
export function parseMeetingTime(text: string, tz = 'Asia/Kolkata', now = DateTime.fromJSDate(clock.now()).setZone(tz)): Date | undefined {
  const t = text.toLowerCase();
  let day: DateTime | undefined;
  if (/day after tomorrow/.test(t)) day = now.plus({ days: 2 });
  else if (/parso/.test(t)) day = now.plus({ days: 2 });
  else if (/tomorrow|tmrw|\bkal\b/.test(t)) day = now.plus({ days: 1 });
  else if (/\btoday|\baaj\b|this (afternoon|evening)|later today/.test(t)) day = now;
  else if (/next week/.test(t)) day = now.plus({ weeks: 1 }).startOf('week');
  else {
    const d = DAYS.findIndex((x) => t.includes(x));
    if (d >= 0) { let diff = d + 1 - now.weekday; if (diff <= 0) diff += 7; day = now.plus({ days: diff }); }
  }
  const tm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|baje)?/);
  let hour: number | undefined, minute = 0;
  if (tm && (tm[3] || tm[2] || /\bat\b/.test(t))) {
    hour = parseInt(tm[1], 10); minute = tm[2] ? parseInt(tm[2], 10) : 0;
    let ap: string | undefined = tm[3]?.replace(/\./g, '');
    if (ap === 'baje') ap = /subah/.test(t) ? 'am' : /shaam|raat|dopahar/.test(t) ? 'pm' : undefined;
    if (ap === 'pm' && hour < 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
    if (!ap && hour >= 1 && hour <= 7) hour += 12; // "at 3" in business context → 3 PM
  } else if (/morning|subah/.test(t)) hour = 11;
  else if (/afternoon/.test(t)) hour = 15;
  else if (/evening|shaam/.test(t)) hour = 17;
  if (!day && hour === undefined) return undefined;
  if (hour !== undefined && (hour > 23 || minute > 59)) return undefined;
  let dt = (day ?? now).set({ hour: hour ?? 11, minute, second: 0, millisecond: 0 });
  if (dt <= now) dt = dt.plus({ days: 1 });
  if (dt.weekday === 7) dt = dt.plus({ days: 1 }); // avoid Sundays
  return dt.toJSDate();
}

export function formatMeetingTime(d: Date, tz = 'Asia/Kolkata') {
  return DateTime.fromJSDate(d).setZone(tz).toFormat("cccc, d LLLL 'at' h:mm a");
}

const WORDNUM: Record<string, number> = { a: 1, one: 1, couple: 2, two: 2, few: 3, three: 3, four: 4, six: 6 };

/** "in two months", "next quarter", "after the holidays" → a follow-up date (defaults to `defaultDays`). */
export function parseFollowUp(text: string, tz = 'Asia/Kolkata', defaultDays = 45, now = DateTime.fromJSDate(clock.now()).setZone(tz)): { at: Date; label: string } {
  const t = text.toLowerCase();
  let dt: DateTime | undefined; let label = '';
  const m = t.match(/(?:in|after|next)\s+(?:a\s+)?(\d+|one|two|three|four|six|few|couple(?: of)?)?\s*(week|month)s?/);
  if (m) {
    const n = m[1] ? (WORDNUM[m[1].replace(' of', '')] ?? parseInt(m[1], 10)) || 1 : 1;
    dt = now.plus(m[2] === 'week' ? { weeks: n } : { months: n });
    label = `${n} ${m[2]}${n > 1 ? 's' : ''}`;
  } else if (/next quarter/.test(t)) { dt = now.plus({ months: 3 }).startOf('quarter').plus({ days: 7 }); label = 'next quarter'; }
  else if (/next year|new year/.test(t)) { dt = now.plus({ years: 1 }).startOf('year').plus({ days: 10 }); label = 'the new year'; }
  else if (/after (the )?(holidays?|christmas)/.test(t)) { dt = now.plus({ months: 1, days: 10 }); label = 'after the holidays'; }
  else { dt = now.plus({ days: defaultDays }); label = `${Math.round(defaultDays / 30) || 1} month${defaultDays >= 60 ? 's' : ''}`; }
  dt = dt.set({ hour: 11, minute: 0, second: 0, millisecond: 0 });
  if (dt.weekday >= 6) dt = dt.plus({ days: 8 - dt.weekday });
  return { at: dt.toJSDate(), label };
}

/** Which parts of a time the prospect actually said. "Tomorrow" has a day but no hour → ask for a time. */
export function timeParts(text: string) {
  const t = text.toLowerCase();
  const hasDay = /\b(today|tonight|tomorrow|tmrw|kal|parso|aaj|day after tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri)\b/.test(t);
  const hasHour = /\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.?|p\.m\.?)\b|\bat\s+\d{1,2}(:\d{2})?\b|\b\d{1,2}:\d{2}\b|\bnoon\b|\bmidday\b|\b(morning|afternoon|evening|lunchtime|subah|shaam|dopahar)\b|\b\d{1,2}\s*baje\b/.test(t);
  return { hasDay, hasHour };
}
