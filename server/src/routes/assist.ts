import { Router } from 'express';
import { z } from 'zod';
import { Business } from '../models/index.js';
import { parse } from '../lib/validate.js';
import { getLLM, safeJson } from '../providers/llm/index.js';
import { salesProfile } from '../services/agent/playbook.js';
import { audienceFor, offerTypeFor } from '../services/agent/categories.js';

/**
 * Writing helper for form fields: rewrite what the user typed so it reads like a real person wrote it, or draft it
 * from the business profile when the field is empty. Uses the LLM when available; otherwise a built-in rewriter.
 */
export const assistRouter = Router();

const FIELDS = {
  description: 'a short "about the business" paragraph (2-4 sentences) — what they do, for whom, and the result they get',
  product: 'a one-sentence product/service description: what it is and the problem it solves',
  audience: 'one sentence describing the ideal customers',
  requirements: 'one sentence on what ideal customers usually need',
  goals: 'one or two sentences on the business goals for this quarter',
  faq_answer: 'a short, friendly answer to a customer question (1-3 sentences)',
  script: 'talking points a salesperson can glance at during a call (3-5 short lines)',
  objective: 'a short phrase the AI caller says in its opener, e.g. "helping salons cut no-shows" (under 12 words, no full stop)',
  instructions: 'extra guidance for an AI sales agent (2-4 short sentences)',
  opening_line: 'a one-sentence phone greeting; may use {{name}} and {{business}}',
  objection_response: 'a calm, honest one-or-two sentence reply to a sales objection',
  note: 'a clear, well-organised note for a knowledge base',
  generic: 'clear, natural text',
} as const;
type FieldKey = keyof typeof FIELDS;

const schema = z.object({
  field: z.enum(Object.keys(FIELDS) as [FieldKey, ...FieldKey[]]).default('generic'),
  text: z.string().max(6000).default(''),
  context: z.string().max(400).optional(), // e.g. the FAQ question, product name, campaign category
});

assistRouter.post('/write', async (req, res) => {
  const body = parse(schema, req.body);
  const b: any = await Business.findById(req.tenant!.businessId).lean();
  const llm = getLLM();
  if (llm) {
    try {
      const r = await llm.chat([
        { role: 'system', content: `You are a skilled copywriter who writes like a real, friendly person — plain words, short sentences, contractions, no buzzwords (no "leverage", "cutting-edge", "solutions", "synergy", "world-class"), no hype or exclamation marks, no emojis. Keep every fact the user gave; never invent numbers, clients or guarantees. Write ${FIELDS[body.field]}. Return JSON {"text": string}.` },
        { role: 'user', content: `Business: ${b?.name || '(freelancer)'} — ${b?.description ?? ''}\nOffer: ${[...(b?.products ?? []), ...(b?.services ?? [])].map((p: any) => `${p.name}: ${p.description ?? ''}`).join('; ')}\n${body.context ? `Context: ${body.context}\n` : ''}${body.text.trim() ? `Rewrite this:\n${body.text}` : 'The field is empty — write a first draft from the business details.'}` },
      ], { json: true, temperature: 0.5, maxTokens: 500 });
      const out = String(safeJson(r.content)?.text ?? '').trim();
      if (out) return res.json({ text: out, engine: 'ai' });
    } catch { /* fall back */ }
  }
  const text = body.text.trim() ? humanize(body.text, body.field) : draft(b ?? {}, body.field, body.context);
  res.json({ text, engine: 'basic' });
});

const SWAPS: [RegExp, string][] = [
  [/\bin order to\b/gi, 'to'],
  [/\bcutting[- ]edge\b/gi, 'modern'], [/\bstate[- ]of[- ]the[- ]art\b/gi, 'modern'], [/\bbest[- ]in[- ]class\b/gi, 'great'], [/\bworld[- ]class\b/gi, 'excellent'],
  [/\bseamless(ly)?\b/gi, 'smooth$1'], [/\bsynerg(y|ies)\b/gi, 'teamwork'], [/\brobust\b/gi, 'reliable'], [/\bholistic\b/gi, 'complete'],
  [/\bempower(s|ed|ing)?\b/gi, 'help$1'], [/\bprior to\b/gi, 'before'], [/\bcommence(s|d)?\b/gi, 'start$1'],
  [/\bend[- ]to[- ]end\b/gi, 'complete'], [/\bone[- ]stop[- ]shop\b/gi, 'all in one place'], [/\binnovative\b/gi, 'new'], [/\bsolutions\b/gi, 'tools'],
  [/\bat this point in time\b/gi, 'now'], [/\bdue to the fact that\b/gi, 'because'], [/\ba large number of\b/gi, 'many'], [/\bvery unique\b/gi, 'unique'],
  [/!+/g, '.'],
];
const CONTRACT: [RegExp, string][] = [
  [/\bwe are\b/gi, "we're"], [/\byou are\b/gi, "you're"], [/\bit is\b/gi, "it's"], [/\bthat is\b/gi, "that's"], [/\bdo not\b/gi, "don't"],
  [/\bdoes not\b/gi, "doesn't"], [/\bcannot\b/gi, "can't"], [/\bwill not\b/gi, "won't"], [/\byou will\b/gi, "you'll"], [/\bwe will\b/gi, "we'll"],
  [/\bI am\b/g, "I'm"], [/\bthey are\b/gi, "they're"], [/\bis not\b/gi, "isn't"], [/\bare not\b/gi, "aren't"], [/\bwe have\b/gi, "we've"],
];
const keepCase = (from: string, to: string) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);

/** Built-in rewrite: plain words, contractions, tidy sentences, long sentences split. Keeps every fact. */
export function humanize(input: string, field: FieldKey = 'generic') {
  let t = input.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  for (const [re, to] of SWAPS) t = t.replace(re, (m, g1) => keepCase(m, to.replace('$1', g1 ?? '')));
  // verbs keep their tense: leverages → uses, facilitated → helped
  const verb = (base: string, forms: [string, string, string, string]) => (m: string, suf: string) => keepCase(m, forms[{ e: 0, es: 1, ed: 2, ing: 3 }[suf.toLowerCase() as 'e'] ?? 0]);
  t = t.replace(/\b(?:leverag|utili[sz])(e|es|ed|ing)\b/gi, verb('use', ['use', 'uses', 'used', 'using']));
  t = t.replace(/\bfacilitat(e|es|ed|ing)\b/gi, verb('help', ['help', 'helps', 'helped', 'helping']));
  if (field !== 'objective') for (const [re, to] of CONTRACT) t = t.replace(re, (m) => keepCase(m, to));
  const lines = t.split('\n').map((line) => {
    const bullet = line.match(/^\s*([-•*]|\d+[.)])\s*/)?.[0] ?? '';
    let body = line.slice(bullet.length).trim();
    if (!body) return '';
    // split run-on sentences at ", and" / "; " when a sentence is long
    body = body.split(/(?<=[.?])\s+/).map((sn) => (sn.split(/\s+/).length > 26 ? sn.replace(/;\s+|,\s+(and|but|so)\s+/i, (m, conj) => `. ${conj ? conj[0].toUpperCase() + conj.slice(1) + ' ' : ''}`) : sn)).join(' ');
    body = body.replace(/(^|[.?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
    if (field !== 'objective' && !bullet && !/[.?:]$/.test(body)) body += '.';
    return bullet + body;
  });
  let out = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+([,.?])/g, '$1').replace(/\.\./g, '.');
  if (field === 'objective') out = out.replace(/[.!]+$/, '').replace(/^./, (c) => c.toLowerCase());
  return out;
}

/** Built-in first draft from what we know about the business. */
export function draft(b: any, field: FieldKey, context?: string) {
  const who = b.name || 'I';
  const helps = b.name ? `${b.name} helps` : 'I help';
  const items: any[] = [...(b.products ?? []), ...(b.services ?? [])].filter((p) => p?.name);
  const aud = audienceFor(context || b.icp?.industries?.[0]).owners;
  const offer = offerTypeFor(b);
  const prof = salesProfile({ business: b, campaign: context ? { category: context } : undefined });
  const what = items[0]?.description ? items[0].description.replace(/\.$/, '').replace(/^./, (c: string) => c.toLowerCase()) : 'getting more customers with less effort';
  switch (field) {
    case 'description': return `${helps} ${b.targetAudience ? b.targetAudience.replace(/\.$/, '').toLowerCase() : aud} with ${what}. ${items.length > 1 ? `${b.name ? 'We also offer' : 'I also offer'} ${items.slice(1, 3).map((i) => i.name).join(' and ')}. ` : ''}The goal is simple: less admin, more of the work that pays.`;
    case 'product': return offer ? `${prof.reason.replace(/^we help /, 'Helps ')}.` : `Helps ${aud} save time every week.`;
    case 'audience': return `${aud[0].toUpperCase() + aud.slice(1)} who want ${what}.`;
    case 'requirements': return `They usually want ${prof.pains.slice(0, 2).map((p) => `fewer problems with ${p.pain}`).join(' and ') || 'more customers and less admin'}.`;
    case 'goals': return `Book more qualified meetings with ${aud} this quarter and turn at least a few into paying customers.`;
    case 'faq_answer': return context ? `Good question. ${b.faqs?.find((f: any) => f.question === context)?.answer ?? `Our team can walk you through ${context.toLowerCase().replace(/\?$/, '')} on a quick call.`}` : 'Happy to help — our team can walk you through it on a quick call.';
    case 'script': return [`Ask how they handle ${prof.pains[0]?.pain ?? 'this'} today.`, 'Find out how often it happens and what it costs them.', `Explain how ${items[0]?.name ?? 'we'} fix${items[0] ? 'es' : ''} it, in one sentence.`, 'Offer a free 15-minute Google Meet — give two day options.'].map((x) => `- ${x}`).join('\n');
    case 'objective': return prof.reason.replace(/^\S+ helps? /, 'helping ');
    case 'instructions': return `Keep it friendly and short. Ask about their current setup before pitching, and only mention ${items[0]?.name ?? 'our offer'} once you know their problem. If they're busy, offer to call back.`;
    case 'opening_line': return b.name ? `Hi {{name}}, it's Sarah from {{business}}.` : `Hi {{name}}, it's Sarah — I work with ${who}.`;
    case 'objection_response': return `That's fair. A lot of people feel that way at first — would a quick 15-minute look help you decide either way?`;
    default: return `${helps} ${aud} with ${what}.`;
  }
}
