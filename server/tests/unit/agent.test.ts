import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { detectIntents, parseMeetingTime, extractBudget } from '../../src/services/agent/nlu.js';
import { start, respond, openingMessage } from '../../src/services/agent/engine.js';
import { ICP_SETTINGS } from '../helpers.js';

// Engine uses retrieval → needs no DB when knowledge lookup returns nothing; stub business id that has no chunks.
// Retrieval hits Mongo, so for pure-unit tests we use paths that don't trigger KB lookups, or tolerate empty answers.
import mongoose from 'mongoose';
import { beforeAll, afterAll } from 'vitest';
beforeAll(async () => { await mongoose.connect(process.env.MONGO_TEST_URI!, { dbName: 'unit_agent' }); });
afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

const business = { _id: new mongoose.Types.ObjectId(), name: 'Acme', ...ICP_SETTINGS, compliance: { timezone: 'Asia/Kolkata', recordCalls: true, requireConsentForRecording: true, recordingConsentMessage: 'This call may be recorded.' } };
const agent = { name: 'Aria', objectionHandling: [{ objection: 'too expensive', response: 'We have a free 14-day trial so you can see the ROI first.' }] };
const lead = { contactName: 'Priya Sharma', companyName: 'Nova Retail' };
const ctx = { business, agent, lead };

describe('intent detection (compliance-critical)', () => {
  it.each([
    'Please do not call me again', "don't call this number", 'remove my number from your list', 'stop calling me', 'unsubscribe',
  ])('detects opt-out: %s', (t) => expect(detectIntents(t).optOut).toBe(true));
  it('does not flag normal sentences as opt-out', () => expect(detectIntents('Yes please call me tomorrow').optOut).toBe(false));
  it('detects AI identity questions and human requests', () => {
    expect(detectIntents('Wait, are you a robot?').asksIfAI).toBe(true);
    expect(detectIntents('Can I speak to a real person?').wantsHuman).toBe(true);
  });
  it('extracts budget', () => expect(extractBudget('around 50k per month')).toMatch(/50k/));
});

describe('meeting time parsing', () => {
  const now = DateTime.fromISO('2026-11-09T10:00:00', { zone: 'Asia/Kolkata' }); // Monday
  it('tomorrow at 3 pm', () => {
    const d = DateTime.fromJSDate(parseMeetingTime('tomorrow at 3 pm', 'Asia/Kolkata', now)!).setZone('Asia/Kolkata');
    expect(d.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-10 15:00');
  });
  it('Thursday 11am', () => {
    const d = DateTime.fromJSDate(parseMeetingTime('Thursday at 11 am', 'Asia/Kolkata', now)!).setZone('Asia/Kolkata');
    expect(d.toFormat('cccc HH:mm')).toBe('Thursday 11:00');
  });
  it('returns undefined without any time reference', () => expect(parseMeetingTime('sounds good', 'Asia/Kolkata', now)).toBeUndefined());
});

describe('conversation engine', () => {
  it('opening always discloses AI identity and recording, even with a custom opening line', () => {
    const msg = openingMessage({ ...ctx, agent: { ...agent, openingLine: 'Hello {{name}}, quick one from {{business}}!' } });
    expect(msg).toMatch(/AI assistant/);
    expect(msg).toMatch(/recorded/);
    expect(msg).toContain('Priya');
  });
  it('honours opt-out immediately and ends the call', async () => {
    const s = start(ctx).state;
    const r = await respond(ctx, s, 'Please remove my number and do not call again');
    expect(r.end).toBe(true);
    expect(r.state.optOut).toBe(true);
    expect(r.actions).toContainEqual({ type: 'opt_out' });
  });
  it('answers honestly when asked if it is an AI', async () => {
    const r = await respond(ctx, start(ctx).state, 'Are you a robot?');
    expect(r.reply).toMatch(/AI assistant/);
    expect(r.end).toBe(false);
  });
  it('records recording consent / refusal', async () => {
    const yes = await respond(ctx, start(ctx).state, 'Yes sure go ahead');
    expect(yes.state.recordingConsent).toBe(true);
    const no = await respond(ctx, start(ctx).state, "Okay but please don't record this");
    expect(no.state.recordingConsent).toBe(false);
  });
  it('qualifies and books a meeting through a full happy path', async () => {
    let { state } = start(ctx);
    const turns = ['Yes, go ahead', 'We use spreadsheets for follow ups', 'The challenge is missing follow-ups, we are looking for something better', 'Within a month, budget about 50k per month', 'Tomorrow at 3 pm works'];
    let last: any;
    for (const t of turns) { last = await respond(ctx, state, t); state = last.state; if (last.end) break; }
    const book = last.actions.find((a: any) => a.type === 'book');
    expect(book?.kind).toBe('meeting');
    expect(state.slots.interest).toBe('yes');
    expect(state.slots.budget).toMatch(/50k/);
    expect(state.slots.requirements.length).toBeGreaterThan(0);
  });
  it('handles one objection with the playbook, then respects a second no', async () => {
    let r = await respond(ctx, start(ctx).state, 'Okay, go on');
    r = await respond(ctx, r.state, "We're not interested, it is too expensive");
    expect(r.reply).toMatch(/free 14-day trial/);
    expect(r.end).toBe(false);
    r = await respond(ctx, r.state, 'No, really not interested');
    expect(r.end).toBe(true);
    expect(r.state.slots.interest).toBe('no');
  });
  it('offers callback scheduling when the prospect is busy', async () => {
    let r = await respond(ctx, start(ctx).state, "I'm driving, call me later");
    expect(r.state.stage).toBe('scheduling');
    r = await respond(ctx, r.state, 'tomorrow evening');
    expect(r.actions.find((a) => a.type === 'book')).toMatchObject({ kind: 'callback' });
    expect(r.end).toBe(true);
  });
  it('transfers to a human when requested and a number is configured', async () => {
    const c = { ...ctx, agent: { ...agent, transferNumber: '+919800000000' } };
    const r = await respond(c, start(c).state, 'I want to talk to a real person');
    expect(r.actions).toContainEqual({ type: 'transfer', number: '+919800000000' });
  });
});

describe('regressions from real user testing', () => {
  const glow = { ...business, name: 'GlowDesk', products: [{ name: 'GlowDesk Booking', description: '24/7 online booking on Instagram, Google and your website' }, { name: 'GlowDesk Reminders', description: 'Automatic text reminders that cut no-shows' }] };
  const c = { business: glow, agent: { name: 'Sarah' }, lead: { contactName: 'Jessica Lee', companyName: 'Copper & Co. Salon' } };
  it('“Thursday at 11am works” books the meeting right away', async () => {
    let r = await respond(c, start(c).state, 'How much does it cost?');
    r = await respond(c, r.state, 'Thursday at 11am works');
    const book = r.actions.find((a: any) => a.type === 'book') as any;
    expect(book?.kind).toBe('meeting');
    expect(book.display).toMatch(/Thursday/);
    expect(r.reply).toMatch(/Google Meet/);
  });
  it('“Tomorrow” without a time asks for the time instead of guessing', async () => {
    let r = await respond(c, start(c).state, 'Sure');
    r = await respond(c, r.state, 'Sounds good, can we meet?');
    r = await respond(c, r.state, 'Tomorrow');
    expect(r.actions.find((a: any) => a.type === 'book')).toBeUndefined();
    expect(r.reply).toMatch(/what time tomorrow/i);
    r = await respond(c, r.state, '3pm');
    expect(r.actions.find((a: any) => a.type === 'book')).toMatchObject({ kind: 'meeting' });
  });
  it('“No thanks” after “anything else?” ends warmly and keeps the meeting', async () => {
    let r = await respond(c, start(c).state, 'Sure');
    r = await respond(c, r.state, 'Thursday at 11am works');
    r = await respond(c, r.state, 'No thanks');
    expect(r.end).toBe(true);
    expect(r.reply).not.toMatch(/won’t keep pushing/);
    expect(r.reply).toMatch(/all set/);
    expect(r.state.slots.interest).toBe('yes');
    expect(r.actions.find((a: any) => a.type === 'not_interested')).toBeUndefined();
  });
  it('connects what the customer says to the right offer', async () => {
    let r = await respond(c, start(c).state, 'Sure, go ahead');
    r = await respond(c, r.state, 'Honestly we get a lot of no-shows, clients just forget');
    expect(r.reply).toMatch(/no-shows/i);
    expect(r.reply).toMatch(/how often/i); // quantify before pitching
    r = await respond(c, r.state, 'Maybe 5 a week');
    expect(r.reply).toMatch(/GlowDesk Reminders/);
    expect(r.state.slots.offered).toContain('GlowDesk Reminders');
  });
  it('wants to meet the owner → asks for a day and time, then books with the founder', async () => {
    let r = await respond(c, start(c).state, 'Sure');
    r = await respond(c, r.state, 'I would rather speak with the owner directly');
    expect(r.reply).toMatch(/founder/);
    r = await respond(c, r.state, 'Friday at 2pm');
    expect(r.actions.find((a: any) => a.type === 'book')).toMatchObject({ kind: 'meeting', with: 'owner' });
  });
});
