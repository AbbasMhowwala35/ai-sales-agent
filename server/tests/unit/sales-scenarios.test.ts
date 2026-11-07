import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { start, respond } from '../../src/services/agent/engine.js';
import { BANNED_PHRASES } from '../../src/services/agent/playbook.js';
import { scoreCall } from '../../src/services/calls/scorecard.js';
import { clock } from '../../src/lib/clock.js';

/**
 * Tough-customer scenarios: the agent is graded like a sales manager would grade a rep.
 * Run with PRINT=1 to read the full conversations.
 */
beforeAll(async () => { await mongoose.connect(process.env.MONGO_TEST_URI!, { dbName: 'unit_sales' }); clock.set(new Date('2026-11-09T15:00:00Z')); });
afterAll(async () => { clock.set(null); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

export const GLOW = {
  _id: new mongoose.Types.ObjectId(), name: 'GlowDesk',
  description: 'GlowDesk fills empty chairs for hair and beauty salons with online booking, automatic reminders and win-back texts. Salons on GlowDesk typically cut no-shows by 35% and rebook 20% more clients within 60 days.',
  products: [
    { name: 'GlowDesk Booking', description: '24/7 online booking on Instagram, Google and your website, synced with every stylist’s calendar', price: '$79 per month per location' },
    { name: 'GlowDesk Reminders & Win-back', description: 'Automatic text and email reminders, plus win-back campaigns for clients who haven’t visited in 60 days', price: '$49 per month' },
  ],
  icp: { keywords: ['hair salon'] },
  compliance: { timezone: 'America/Chicago', recordCalls: true, requireConsentForRecording: true },
};
const SARAH = {
  name: 'Sarah', title: 'Senior Account Executive', style: 'natural',
  objectionHandling: [{ objection: 'already have vagaro square booking system software', response: 'Makes sense — plenty of salons use Vagaro or Square.' }],
};
const ctx: any = { business: GLOW, agent: SARAH, campaign: { category: 'Salons' }, lead: { contactName: 'Jessica Lee', companyName: 'Copper & Co. Salon', source: 'google_places', location: { city: 'Austin', state: 'Texas', country: 'USA' } } };

async function talk(lines: string[]) {
  let { state, reply } = start(ctx);
  const turns: { who: 'agent' | 'customer'; text: string }[] = [{ who: 'agent', text: reply }];
  const actions: any[] = [];
  let ended = false;
  for (const l of lines) {
    turns.push({ who: 'customer', text: l });
    const r = await respond(ctx, state, l);
    state = r.state; actions.push(...r.actions); turns.push({ who: 'agent', text: r.reply });
    if (r.end) { ended = true; break; }
  }
  if (process.env.PRINT) console.log('\n' + turns.map((t) => `${t.who === 'agent' ? 'SARAH   ' : 'CUSTOMER'}: ${t.text}`).join('\n'));
  return { turns, actions, state, ended, agentLines: turns.filter((t) => t.who === 'agent').map((t) => t.text) };
}

/** Rules every call must follow, whatever the customer does. */
function professional(c: Awaited<ReturnType<typeof talk>>) {
  for (const line of c.agentLines) {
    expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(62); // short turns on the phone
    expect((line.match(/\?/g) ?? []).length, line).toBeLessThanOrEqual(2); // one ask at a time
    for (const re of BANNED_PHRASES) expect(line, line).not.toMatch(re);
  }
  expect(new Set(c.agentLines).size).toBe(c.agentLines.length); // never repeats itself word for word
  expect(c.agentLines[0]).toMatch(/AI assistant/);
  expect(c.agentLines[0]).toMatch(/reason I’m calling/i);
  expect(c.agentLines[0]).not.toMatch(/bad time|okay time/i);
}

describe('sales playbook — tough customers', () => {
  it('ideal call: problem menu → label → quantify → tailored pitch + proof → two-day close → booked', async () => {
    const c = await talk(['Sure, go ahead', 'Honestly the no-shows are killing us', 'Probably 4 or 5 a week', 'Yeah okay, let’s do it', 'Thursday at 11am', 'No, that’s it']);
    professional(c);
    expect(c.agentLines[1]).toMatch(/one of three things/);
    expect(c.agentLines[2]).toMatch(/how often/i);
    expect(c.agentLines[3]).toMatch(/22 a month/); // used THEIR number back
    expect(c.agentLines[3]).toMatch(/GlowDesk Reminders/);
    expect(c.agentLines[3]).toMatch(/35%/); // a real result from the business description
    expect(c.agentLines[3]).toMatch(/Tuesday|Wednesday|tomorrow/i); // either/or close
    expect(c.actions.find((a) => a.type === 'book')).toMatchObject({ kind: 'meeting' });
    expect(scoreCall(c.turns, { booked: true }).score).toBeGreaterThanOrEqual(85);
  });

  it('“Not interested” at the opener gets one respectful reframe, then a real conversation', async () => {
    const c = await talk(['Not interested', 'Fine, go on', 'The phone, I miss calls all the time when I’m with a client', 'Maybe 10 a week', 'Sure', 'Wednesday 2pm', 'Nope']);
    professional(c);
    expect(c.agentLines[1]).toMatch(/weren’t expecting|out of the blue/);
    expect(c.agentLines[4]).toMatch(/GlowDesk Booking/);
    expect(c.actions.find((a) => a.type === 'book')).toBeTruthy();
  });

  it('two clear “no”s → stops selling, thanks them, leaves the door open', async () => {
    const c = await talk(['Not interested', 'No.']);
    professional(c);
    expect(c.ended).toBe(true);
    expect(c.agentLines.at(-1)).toMatch(/you’ve got our number/);
    expect(c.actions).toContainEqual({ type: 'not_interested' });
  });

  it('“Is this a sales call?” → disarmingly honest, earns 30 seconds', async () => {
    const c = await talk(['Is this a sales call?', 'Okay, 30 seconds', 'Quiet days mostly, Tuesdays are dead']);
    professional(c);
    expect(c.agentLines[1]).toMatch(/it is/i);
    expect(c.agentLines[2]).toMatch(/one of three things/);
    expect(c.agentLines[3]).toMatch(/how often|GlowDesk/);
  });

  it('“How did you get my number?” → the truth, plus an immediate way out', async () => {
    const c = await talk(['How did you get my number?', 'Okay fine, go ahead']);
    professional(c);
    expect(c.agentLines[1]).toMatch(/listed publicly/);
    expect(c.agentLines[1]).toMatch(/take you off our list/);
  });

  it('existing competitor → no bashing; finds the gap; pitches only the gap', async () => {
    const c = await talk(['Sure', 'We already use Vagaro', 'It’s easy for clients to book', 'The fees are pretty high honestly, and clients still forget', 'Okay', 'Tuesday at 2pm']);
    professional(c);
    expect(c.agentLines.join(' ')).not.toMatch(/bad|worse|terrible/i);
    expect(c.agentLines[2]).toMatch(/like most about Vagaro/);
    expect(c.agentLines[3]).toMatch(/change one thing/);
    expect(c.agentLines[4]).toMatch(/GlowDesk/);
    expect(c.actions.find((a) => a.type === 'book')).toBeTruthy();
  });

  it('happy with current setup → respects it and asks permission to check back later', async () => {
    const c = await talk(['Go on', 'We already have a system that works', 'It just works, the team knows it', 'Nothing really', 'Sure, that’s fine']);
    professional(c);
    expect(c.actions.find((a) => a.type === 'nurture')).toBeTruthy();
    expect(c.actions.find((a) => a.type === 'not_interested')).toBeUndefined();
  });

  it('“Just send me an email” → agrees, then makes it useful by finding the real problem', async () => {
    const c = await talk(['Okay', 'Just send me an email', 'Probably the no-shows', 'About 3 a week']);
    professional(c);
    expect(c.agentLines[2]).toMatch(/Happy to/);
    expect(c.agentLines[2]).toMatch(/which matters more/);
    expect(c.agentLines[4]).toMatch(/GlowDesk Reminders/);
  });

  it('“Too expensive” → free look framing once; second no ends it', async () => {
    const c = await talk(['Sure', 'What does it cost?', 'That’s too expensive for us', 'No, really not interested']);
    professional(c);
    expect(c.agentLines[3]).toMatch(/free|no hard feelings/);
    expect(c.ended).toBe(true);
  });

  it('“I need to talk to my partner” → invites the partner to the meeting', async () => {
    const c = await talk(['Sure', 'Empty chairs on weekdays for sure', 'Maybe 6 a week', 'I’d have to talk to my business partner first', 'Yes, Friday at 10am works']);
    professional(c);
    expect(c.agentLines[4]).toMatch(/bring them on the Google Meet/);
    expect(c.actions.find((a) => a.type === 'book')).toBeTruthy();
  });

  it('“Not a priority right now” → asks permission to follow up instead of pushing', async () => {
    const c = await talk(['Go ahead', 'No-shows I guess', 'A couple a week', 'Not interested', 'It’s just not a priority right now, busy season', 'Sure']);
    professional(c);
    expect(c.agentLines[5]).toMatch(/check back/);
    expect(c.actions.find((a) => a.type === 'nurture')).toBeTruthy();
  });

  it('“we use an old system” → hears the buying signal and asks what bothers them', async () => {
    const c = await talk(['Sure', 'We use an old system for that', 'It’s slow and clients can’t book online', 'Yeah, okay', 'Thursday at 3pm']);
    professional(c);
    expect(c.agentLines[2]).toMatch(/most annoying/);
    expect(c.agentLines[3]).toMatch(/GlowDesk Booking/);
    expect(c.actions.find((a) => a.type === 'book')).toBeTruthy();
  });

  it('opt-out mid-pitch is honoured instantly, no persuasion', async () => {
    const c = await talk(['Sure', 'Stop calling me, take me off your list']);
    expect(c.ended).toBe(true);
    expect(c.actions).toContainEqual({ type: 'opt_out' });
    expect(c.agentLines.at(-1)).not.toMatch(/\?/);
  });
});

describe('any category, any business — the agent works out the pitch itself', () => {
  const PIXEL = { _id: new mongoose.Types.ObjectId(), name: 'PixelForge', description: 'PixelForge builds fast, mobile-friendly websites and handles SEO for small organisations. Clients typically get twice as many enquiries within 90 days.', products: [{ name: 'Website rebuild', description: 'A modern, mobile-friendly website with SEO set up so you show up on Google' }, { name: 'Care plan', description: 'Monthly updates, hosting and security' }], compliance: { recordCalls: true } };
  const run = async (business: any, category: string, lines: string[]) => {
    const c: any = { business, agent: { name: 'Maya' }, campaign: { category }, lead: { contactName: 'Sam Patel', companyName: 'Test Org' } };
    let { state, reply } = start(c); const out = [reply];
    for (const l of lines) { const r = await respond(c, state, l); state = r.state; out.push(r.reply); if (r.end) break; }
    if (process.env.PRINT) console.log(`\n[${business.name} → ${category}]\n` + out.join('\n'));
    return out;
  };
  it('website agency → NGOs: talks about donors and donating, pitches the website', async () => {
    const o = await run(PIXEL, 'NGO', ['Sure', 'Honestly our website is really old and breaks on phones', 'Most of our donors come from mobile, maybe 20 a week bounce']);
    expect(o[0]).toMatch(/we help nonprofits get found on Google and turn website visitors into donors/);
    expect(o[1]).toMatch(/Most nonprofits I talk to/);
    expect(o[1]).toMatch(/without donating/);
    expect(o[2]).toMatch(/dated or breaks on mobile/);
    expect(o[2]).toMatch(/reach out through the website/);
    expect(o[3]).toMatch(/our Website rebuild is for — a modern, mobile-friendly website/);
    expect(o[3]).not.toMatch(/salon|no-shows/i);
  });
  it('website agency → dentists: patients, booking an appointment', async () => {
    const o = await run(PIXEL, 'Dentists', ['Go ahead']);
    expect(o[0]).toMatch(/clinic owners/);
    expect(o[1]).toMatch(/without booking an appointment/);
  });
  it('booking app → restaurants: diners, reservations, tables, mid-service', async () => {
    const o = await run(GLOW, 'Restaurants', ['Sure']);
    expect(o[0]).toMatch(/restaurant owners/);
    expect(o[1]).toMatch(/diners not showing up for reservations/);
    expect(o[1]).toMatch(/in the middle of service/);
    expect(o[1]).toMatch(/empty tables/);
  });
  it('a category it has never seen still gets a sensible pitch', async () => {
    const o = await run(GLOW, 'Yacht charters', ['Sure']);
    expect(o[0]).toMatch(/yacht charter owners/);
    expect(o[1]).toMatch(/one of three things/);
  });
});
