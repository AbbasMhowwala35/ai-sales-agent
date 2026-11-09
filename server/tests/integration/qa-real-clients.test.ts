import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { useDb, register, api } from '../helpers.js';
import { clock } from '../../src/lib/clock.js';

useDb();

/** Ten real-life prospects, replayed against a freelancer web-development profile (same as the live beta account). */
const PROFILE = {
  description: 'We are a technology-driven digital solutions company helping businesses grow through innovative web development and AI-powered automation. We specialize in building modern, scalable websites and web applications, eCommerce solutions, and custom software.',
  products: [
    { name: 'Website Development', price: 'Starts $ 200', description: 'We provide professional web development services to help businesses establish a strong online presence and grow digitally.' },
    { name: 'Website Maintenance', price: '$99 per month', description: 'We provide reliable website maintenance services to keep your website secure, updated, and running smoothly.' },
  ],
  compliance: { timezone: 'Asia/Kolkata', callingDays: [1, 2, 3, 4, 5, 6], callingWindowStart: '09:00', callingWindowEnd: '20:00', recordCalls: true },
};
const OPENING = 'Hey {{name}}! How are you doing today? I\'m Oliver, calling on behalf of {{business}}. We help businesses improve their online presence through professional website development, website maintenance, and digital solutions. Would you be open to a quick 30-second conversation?';

async function setup() {
  const r = await register({ name: 'Abbas Mhowwala', businessName: '' });
  await api(r.token).patch('/api/business', PROFILE);
  const agentId = (await api(r.token).get('/api/agents')).body.agents[0]._id;
  await api(r.token).patch(`/api/agents/${agentId}`, { name: 'Oliver', openingLine: OPENING });
  return { r, agentId };
}
async function talk(token: string, agentId: string, category: string, lead: any, lines: string[]) {
  const log: string[] = []; const turns: any[] = [];
  let res = (await api(token).post(`/api/agents/${agentId}/test-chat`, { category, lead })).body;
  log.push(`AGENT: ${res.reply}`); turns.push(res);
  for (const m of lines) {
    if (res.end) break;
    res = (await api(token).post(`/api/agents/${agentId}/test-chat`, { category, lead, message: m, state: res.state })).body;
    log.push(`CLIENT: ${m}`, `AGENT: ${res.reply}${res.actions?.length ? `  {${res.actions.map((a: any) => a.type + (a.display ? ' ' + a.display : '')).join(', ')}}` : ''}${res.end ? ' [END]' : ''}`);
    turns.push(res);
  }
  return { log, turns, last: res };
}
const IN = { location: { city: 'Indore', state: 'Madhya Pradesh', country: 'India' } };
const transcripts: string[] = [];
const keep = (name: string, log: string[]) => transcripts.push(`### ${name}\n${log.join('\n')}`);

describe('QA: real-life clients (beta sign-off)', () => {
  it('runs the ten scenarios', async () => {
    clock.set(new Date('2026-11-09T06:30:00Z')); // Monday 12:00 IST
    try {
      const { r, agentId } = await setup();
      const T = r.token;
      const no = (re: RegExp, xs: any[]) => xs.forEach((x) => expect(x.reply).not.toMatch(re));
      const BANNED = /(Ask how they|Company:|Who we serve:|^- |Starts \$ |Hey !|Hey Dr\.!|online booking at)/;

      // 1. Interested salon owner with no website → books, gives email
      let c = await talk(T, agentId, 'Salons', { contactName: 'Priya Sharma', companyName: 'Glow Studio', ...IN }, ['Yes sure, go ahead', 'Honestly people find us only through Instagram, we have no website', 'Maybe 10-15 enquiries a month get lost I think', 'What would it cost?', 'Okay that sounds reasonable, how does it work?', 'Yes lets talk, Thursday works', '4pm', 'priya@glowstudio.in']);
      keep('1 Interested salon owner, no website', c.log);
      no(BANNED, c.turns);
      expect(c.turns[0].reply).not.toMatch(/The reason I’m calling/); // custom opener isn't followed by a second pitch
      expect(c.turns[2].reply).toMatch(/Instagram/); expect(c.turns[2].reply).not.toMatch(/through the website/);
      expect(c.turns[4].reply).toMatch(/Website Development starts at \$200/);
      expect(c.turns[5].reply).toMatch(/15-minute call/);
      const booked = c.turns.flatMap((t) => t.actions ?? []).find((a: any) => a.type === 'book');
      expect(booked.display).toBe('Thursday, 12 November at 4:00 PM');
      expect(c.turns[8].reply).toMatch(/priya@glowstudio\.in/);

      // 2. Busy → callback
      c = await talk(T, agentId, 'Restaurants', { contactName: 'Rahul Verma', companyName: 'Spice Route', ...IN }, ['I am in the middle of lunch rush, can you call later?', 'Tomorrow around 5 in the evening']);
      keep('2 Busy restaurant owner', c.log); no(BANNED, c.turns);
      expect(c.last.actions[0]).toMatchObject({ type: 'book', kind: 'callback', display: 'Tuesday, 10 November at 5:00 PM' });

      // 3. Flat not interested → one try, then a polite exit
      c = await talk(T, agentId, 'Gyms', { contactName: 'Vikram Singh', companyName: 'Iron Den Gym', ...IN }, ['Not interested', 'I said not interested, we are fine']);
      keep('3 Not interested', c.log);
      expect(c.last.end).toBe(true); expect(c.last.actions[0].type).toBe('not_interested');

      // 4. "Am I talking to a robot?" → honest; then curious; asks for WhatsApp details
      c = await talk(T, agentId, 'Dentists', { contactName: 'Dr. Anjali Mehta', companyName: 'Smile Care Dental', ...IN }, ['Wait, am I talking to a robot?', 'Okay, what is this about then?', 'We already have a website', 'It was made in 2018, it is slow honestly', 'Send me some details on WhatsApp', 'Okay sure']);
      keep('4 Asks if robot, wants WhatsApp details', c.log); no(BANNED, c.turns);
      expect(c.turns[0].reply).toMatch(/Hey Dr\. Mehta!/);
      expect(c.turns[1].reply).toMatch(/AI assistant/);
      expect(c.turns[2].reply).toMatch(/get found on Google/);
      expect(c.turns[5].reply).toMatch(/WhatsApp/);
      expect(c.last.end).toBe(true);

      // 5. Price objection → answers price, handles budget honestly, gives the cheapest option
      c = await talk(T, agentId, 'Real Estate', { contactName: 'Karan Malhotra', companyName: 'Malhotra Realty', ...IN }, ['Okay go on', 'How much do you charge?', 'That is too expensive for us', 'We are a small firm, budget is tight', 'Fine, what is the cheapest option?']);
      keep('5 Price objection', c.log); no(BANNED, c.turns);
      expect(c.turns[2].reply).toMatch(/\$200/); expect(c.turns[2].reply).toMatch(/\$99 per month/);
      expect(c.turns.map((t) => t.reply).join(' ')).not.toMatch(/no-shows|empty chair/);

      // 6. Angry, do-not-call → removed immediately
      c = await talk(T, agentId, 'Clinics', { contactName: 'Sunita Rao', companyName: 'Rao Clinic', ...IN }, ['How did you get my number? Stop calling me']);
      keep('6 Angry, do not call', c.log);
      expect(c.last.actions[0].type).toBe('opt_out'); expect(c.last.end).toBe(true);

      // 7. Receptionist → gets the owner's name and the best time, books a callback
      c = await talk(T, agentId, 'Hotels', { contactName: 'Amit Joshi', companyName: 'Lake View Hotel', designation: 'Receptionist', ...IN }, ['I am just the receptionist, the owner is not here', 'He comes in mornings, his name is Mr. Kapoor']);
      keep('7 Receptionist (not the decision maker)', c.log); no(BANNED, c.turns);
      expect(c.turns[1].reply).toMatch(/best time to catch the owner/);
      expect(c.last.reply).toMatch(/Mr\. Kapoor/); expect(c.last.actions[0]).toMatchObject({ type: 'book', kind: 'callback' });

      // 8. NGO with questions → books Monday 11am
      c = await talk(T, agentId, 'NGO', { contactName: 'Fatima Khan', companyName: 'Hope Foundation', ...IN }, ['Sure', 'We get donations mostly offline at events', 'Can donors pay online through the website?', 'Do you give discounts for NGOs?', 'Okay book a call for Monday 11am', 'fatima@hopefoundation.org']);
      keep('8 NGO with questions', c.log); no(BANNED, c.turns);
      expect(c.turns.flatMap((t) => t.actions ?? []).find((a: any) => a.type === 'book').display).toBe('Monday, 16 November at 11:00 AM');

      // 9. Hinglish speaker
      c = await talk(T, agentId, 'Salons', { contactName: 'Neha Gupta', companyName: 'Neha Beauty Parlour', ...IN }, ['Haan boliye', 'Website hai nahi abhi, Instagram pe hi chalta hai', 'Kitna kharcha hoga?', 'Theek hai, kal baat karte hain', 'shaam 6 baje']);
      keep('9 Hinglish speaker', c.log); no(BANNED, c.turns);
      expect(c.turns[2].reply).toMatch(/Instagram/);
      expect(c.turns[3].reply).toMatch(/\$200/);
      expect(c.turns[4].reply).toMatch(/what time tomorrow/);
      expect(c.last.actions?.[0]).toMatchObject({ type: 'book', kind: 'callback', display: 'Tuesday, 10 November at 6:00 PM' });

      // 10. Skeptic who wants proof
      c = await talk(T, agentId, 'Coaching Institutes', { contactName: 'Sanjay Patel', companyName: 'Bright Minds Academy', ...IN }, ['Who are you exactly and which company?', 'Have you worked with any coaching institutes before? Show me examples', 'How do I know you are not a scam?', 'Okay, email me your portfolio', 'sanjay@brightminds.in']);
      keep('10 Skeptic wants proof', c.log); no(BANNED, c.turns);
      expect(c.turns[1].reply).toMatch(/AI assistant working with Abbas/);
      expect(c.turns[2].reply).toMatch(/examples of past work/);
      expect(c.turns[3].reply).toMatch(/portfolio/);
      const replies = c.turns.map((t) => t.reply);
      expect(new Set(replies).size).toBe(replies.length); // never repeats itself
      expect(c.last.reply).toMatch(/sanjay@brightminds\.in/);
    } finally {
      clock.set(null);
      writeFileSync(process.env.QA_OUT ?? '/tmp/qa-transcripts.md', transcripts.join('\n\n'));
    }
  });
});

describe('free AI models (Groq / Gemini)', () => {
  it('a per-minute limit pauses the AI briefly instead of switching it off for good', async () => {
    const { isRateLimit } = await import('../../src/providers/llm/index.js');
    expect(isRateLimit(new Error('OpenAI API error 429: Rate limit reached for model llama-3.3-70b-versatile on tokens per minute (TPM)'))).toBe(true);
    expect(isRateLimit(new Error('OpenAI API error 429: {"error":{"status":"RESOURCE_EXHAUSTED"}}'))).toBe(true);
    expect(isRateLimit(new Error('OpenAI API error 429: insufficient_quota'))).toBe(false);
  });
});
