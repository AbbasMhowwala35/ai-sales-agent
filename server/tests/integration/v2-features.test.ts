import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { useDb, register, api, ICP_SETTINGS } from '../helpers.js';
import { drain } from '../../src/queue/queue.js';
import { schedulerTick } from '../../src/services/campaigns/scheduler.js';
import { clock } from '../../src/lib/clock.js';
import { setTelephony } from '../../src/providers/telephony/index.js';
import { Call, Lead, Campaign, LeadSource } from '../../src/models/index.js';
import { canCall, leadTimezone, resolveCallerId } from '../../src/services/calls/compliance.js';
import { parseFollowUp } from '../../src/services/agent/nlu.js';

useDb();
const IST_11AM_MON = new Date('2026-11-09T05:30:00Z');
const NY_11AM_MON = new Date('2026-11-09T16:00:00Z'); // 11:00 New York, 08:00 Los Angeles

async function biz(extra: any = {}) {
  const r = await register();
  await api(r.token).patch('/api/business', { ...ICP_SETTINGS, compliance: { callingDays: [1, 2, 3, 4, 5], callingWindowStart: '10:00', callingWindowEnd: '19:00' }, ...extra });
  return r;
}
async function lead(token: string, body: any, tags?: string[]) {
  const l = await api(token).post('/api/leads', { contactName: 'Jess Miller', industry: 'Retail', ...body });
  expect(l.status).toBe(201);
  await api(token).post('/api/leads/bulk', { ids: [l.body._id], action: 'approve' });
  if (tags) await Lead.collection.updateOne({ _id: (await import('mongoose')).Types.ObjectId.createFromHexString(l.body._id) }, { $set: { tags } });
  return l.body._id as string;
}

describe('foreign calling: local caller ID and the prospect’s local time', () => {
  it('derives time zones from US states and UK numbers', () => {
    expect(leadTimezone({ phone: '+14155550123', location: { state: 'CA', country: 'USA' } }, 'Asia/Kolkata')).toBe('America/Los_Angeles');
    expect(leadTimezone({ phone: '+12125550123', location: { state: 'New York' } }, 'Asia/Kolkata')).toBe('America/New_York');
    expect(leadTimezone({ phone: '+447700900123' }, 'Asia/Kolkata')).toBe('Asia/Kolkata'); // invalid UK test number → fallback
    expect(leadTimezone({ phone: '+442071838750' }, 'Asia/Kolkata')).toBe('Europe/London');
  });
  it('picks the caller ID registered for the prospect’s country and blocks countries without one', async () => {
    const r = await biz({ callerIds: [{ country: 'US', number: '+1 415 555 0100' }, { country: 'GB', number: '+44 20 7183 8750' }] });
    const b = (await api(r.token).get('/api/business')).body;
    expect(b.callerIds[0].number).toBe('+14155550100');
    expect(resolveCallerId(b, { phone: '+12125550199' }).number).toBe('+14155550100');
    expect(resolveCallerId(b, { phone: '+442071838751' }).number).toBe('+442071838750');
    expect(resolveCallerId(b, { phone: '+16135550123' }).number).toBe('+14155550100'); // Canada shares +1
    expect(resolveCallerId(b, { phone: '+61291234567' }).missing).toBe(true);
    clock.set(NY_11AM_MON);
    const au = await lead(r.token, { companyName: 'Sydney Salon', phone: '+61 2 9123 4567', city: 'Sydney', country: 'Australia' });
    const auLead = await Lead.findOne({ businessId: r.businessId, _id: au });
    const check = await canCall(auLead, b, null, { provider: 'twilio' });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/No local caller ID for AU/);
  });
  it('dials US prospects from the US number, only inside THEIR local hours', async () => {
    const r = await biz({ callerIds: [{ country: 'US', number: '+14155550100' }] });
    const dialed: any[] = [];
    setTelephony({ id: 'twilio', dial: async (req) => { dialed.push(req); return { providerCallId: 'CAx' }; } });
    const ny = await lead(r.token, { companyName: 'Brooklyn Cuts', phone: '+1 212 555 0142', city: 'New York', country: 'USA' });
    const la = await lead(r.token, { companyName: 'LA Glow Salon', phone: '+1 310 555 0177', city: 'Los Angeles', country: 'USA' });
    await Lead.updateOne({ businessId: r.businessId, _id: la }, { 'location.state': 'CA' });
    await Lead.updateOne({ businessId: r.businessId, _id: ny }, { 'location.state': 'NY' });
    clock.set(NY_11AM_MON); // 11:00 NY (ok) but 08:00 LA (before 10:00 business window)
    expect((await api(r.token).post('/api/calls', { leadId: ny })).status).toBe(202);
    const blocked = await api(r.token).post('/api/calls', { leadId: la });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/America\/Los_Angeles/);
    await drain();
    expect(dialed).toHaveLength(1);
    expect(dialed[0].from).toBe('+14155550100');
    expect(dialed[0].to).toBe('+12125550142');
  });
});

describe('what the prospect wants: outcomes and automatic follow-ups', () => {
  it('“not now, try in two months” → nurture outcome, then an automatic call when the date arrives', async () => {
    clock.set(IST_11AM_MON);
    const r = await biz();
    const id = await lead(r.token, { companyName: 'Seasonal Spa', phone: '+919876700001', city: 'Pune', country: 'India' }, ['sim:later']);
    expect((await api(r.token).post('/api/calls', { leadId: id })).status).toBe(202);
    await drain();
    let l = await Lead.findOne({ businessId: r.businessId, _id: id });
    expect(l!.outcome).toBe('nurture');
    expect(l!.outcomeNote).toMatch(/2 months/);
    const due = DateTime.fromJSDate(l!.followUpAt!).setZone('Asia/Kolkata');
    expect(Math.round(due.diff(DateTime.fromJSDate(IST_11AM_MON), 'days').days)).toBeGreaterThanOrEqual(59);
    expect((await api(r.token).get('/api/leads?outcome=nurture')).body.total).toBe(1);
    // nothing happens before the date
    await schedulerTick(); await drain();
    expect(await Call.countDocuments({ businessId: r.businessId })).toBe(1);
    // two months later, during business hours → auto follow-up call
    await Lead.updateOne({ businessId: r.businessId, _id: id }, { tags: ['sim:interested'] });
    clock.set(DateTime.fromJSDate(l!.followUpAt!).plus({ hours: 1 }).toJSDate());
    await schedulerTick(); await drain();
    expect(await Call.countDocuments({ businessId: r.businessId })).toBe(2);
    l = await Lead.findOne({ businessId: r.businessId, _id: id });
    expect(l!.outcome).toBe('meeting');
  });
  it('callback at a time → auto call back then; not interested → closed and never called again', async () => {
    clock.set(IST_11AM_MON);
    const r = await biz();
    const cb = await lead(r.token, { companyName: 'Busy Barbers', phone: '+919876700002' }, ['sim:call_later']);
    const no = await lead(r.token, { companyName: 'No Thanks Nails', phone: '+919876700003' }, ['sim:not_interested']);
    await api(r.token).post('/api/calls', { leadId: cb });
    await api(r.token).post('/api/calls', { leadId: no });
    await drain();
    const cbLead = await Lead.findOne({ businessId: r.businessId, _id: cb });
    const noLead = await Lead.findOne({ businessId: r.businessId, _id: no });
    expect(cbLead!.outcome).toBe('callback');
    expect(cbLead!.outcomeNote).toMatch(/call back/i);
    expect(noLead!.outcome).toBe('not_interested');
    expect(noLead!.status).toBe('lost');
    const counts = (await api(r.token).get('/api/leads/outcomes')).body.counts;
    expect(counts).toMatchObject({ callback: 1, not_interested: 1 });
    clock.set(new Date(cbLead!.followUpAt!.getTime() + 5 * 60_000));
    await schedulerTick(); await drain();
    expect(await Call.countDocuments({ businessId: r.businessId, leadId: cb })).toBe(2);
    expect(await Call.countDocuments({ businessId: r.businessId, leadId: no })).toBe(1);
  });
  it('lets a rep change the outcome and follow-up date manually', async () => {
    const r = await biz();
    const id = await lead(r.token, { companyName: 'Manual Co', phone: '+919876700004' });
    const at = new Date(Date.now() + 30 * 86400_000).toISOString();
    const u = await api(r.token).patch(`/api/leads/${id}`, { outcome: 'nurture', outcomeNote: 'Budget opens in Q1', followUpAt: at });
    expect(u.body.outcome).toBe('nurture');
    expect(u.body.followUpAt).toBe(at);
  });
  it('parses follow-up phrases', () => {
    const now = DateTime.fromISO('2026-11-09T10:00', { zone: 'America/New_York' });
    expect(parseFollowUp('maybe check back in a couple of months', 'America/New_York', 45, now).label).toBe('2 months');
    expect(parseFollowUp('try me in 3 weeks', 'America/New_York', 45, now).label).toBe('3 weeks');
    expect(parseFollowUp('next quarter', 'America/New_York', 45, now).label).toBe('next quarter');
  });
});

describe('campaign auto-research until the end date', () => {
  it('researches on its cadence, auto-approves good fits, adds them to the campaign and stops at the end date', async () => {
    clock.set(IST_11AM_MON);
    const r = await biz();
    const agentId = (await api(r.token).get('/api/agents')).body.agents[0]._id;
    const endDate = new Date(IST_11AM_MON.getTime() + 10 * 86400_000);
    const c = await api(r.token).post('/api/campaigns', {
      name: 'USA salons', agentId, autoCalling: false, endDate,
      research: { enabled: true, provider: 'sandbox', keywords: ['hair salon'], industries: ['Retail'], locations: ['Austin, USA'], frequency: 'weekly', leadsPerRun: 15, autoApproveMinScore: 40 },
    });
    expect(c.status).toBe(201);
    expect((await api(r.token).post(`/api/campaigns/${c.body._id}/start`)).status).toBe(200);
    await drain();
    let camp = await Campaign.findOne({ businessId: r.businessId, _id: c.body._id });
    expect(await LeadSource.countDocuments({ businessId: r.businessId, campaignId: c.body._id })).toBe(1);
    expect(camp!.research!.totalAdded).toBeGreaterThan(0);
    const detail = (await api(r.token).get(`/api/campaigns/${c.body._id}`)).body;
    expect(detail.leads.length).toBe(camp!.research!.totalAdded);
    // a day later: not due yet (weekly)
    clock.set(new Date(IST_11AM_MON.getTime() + 86400_000));
    await schedulerTick(); await drain();
    expect(await LeadSource.countDocuments({ businessId: r.businessId, campaignId: c.body._id })).toBe(1);
    // a week later: second run
    clock.set(new Date(IST_11AM_MON.getTime() + 7 * 86400_000 + 60_000));
    await schedulerTick(); await drain();
    expect(await LeadSource.countDocuments({ businessId: r.businessId, campaignId: c.body._id })).toBe(2);
    // after the end date: no more research and the campaign completes
    clock.set(new Date(endDate.getTime() + 86400_000));
    await Campaign.updateOne({ businessId: r.businessId, _id: c.body._id }, { autoCalling: true });
    await schedulerTick(); await drain();
    camp = await Campaign.findOne({ businessId: r.businessId, _id: c.body._id });
    expect(camp!.status).toBe('completed');
    expect(await LeadSource.countDocuments({ businessId: r.businessId, campaignId: c.body._id })).toBe(2);
  });
});

describe('PDF reports & voice', () => {
  it('downloads analytics, leads, follow-ups, campaign and call reports as PDF', async () => {
    clock.set(IST_11AM_MON);
    const r = await biz();
    const id = await lead(r.token, { companyName: 'Report Co', phone: '+919876700009' }, ['sim:interested']);
    const call = await api(r.token).post('/api/calls', { leadId: id });
    await drain();
    const agentId = (await api(r.token).get('/api/agents')).body.agents[0]._id;
    const camp = await api(r.token).post('/api/campaigns', { name: 'PDF test', agentId, leadIds: [id] });
    for (const path of ['/api/reports/analytics.pdf', '/api/reports/leads.pdf?outcome=meeting', '/api/reports/follow-ups.pdf', `/api/reports/campaigns/${camp.body._id}.pdf`, `/api/reports/calls/${call.body._id}.pdf`]) {
      const res = await api(r.token).get(path).buffer(true).parse((resp, cb) => { const chunks: Buffer[] = []; resp.on('data', (c: Buffer) => chunks.push(c)); resp.on('end', () => cb(null, Buffer.concat(chunks))); });
      expect(res.status, path).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect((res.body as Buffer).length).toBeGreaterThan(1500);
    }
    const other = await register();
    expect((await api(other.token).get(`/api/reports/calls/${call.body._id}.pdf`)).status).toBe(404);
  });
  it('voice preview falls back to the browser when ElevenLabs is not configured; cloning requires consent', async () => {
    const r = await biz();
    const agent = (await api(r.token).get('/api/agents')).body;
    expect(agent.naturalVoices.length).toBeGreaterThan(5);
    const prev = await api(r.token).post(`/api/agents/${agent.agents[0]._id}/voice-preview`, {});
    expect(prev.status).toBe(204);
    expect(prev.headers['x-voice-fallback']).toBe('browser');
    const clone = await api(r.token).post(`/api/agents/${agent.agents[0]._id}/voice-clone`).field('consent', 'false');
    expect(clone.status).toBe(400);
  });
  it('sounds human but stays honest: short disclosure in the opener, truthful when asked', async () => {
    const r = await biz();
    const id = (await api(r.token).get('/api/agents')).body.agents[0]._id;
    const s = await api(r.token).post(`/api/agents/${id}/test-chat`, {});
    expect(s.body.reply).toMatch(/AI assistant/);
    expect(s.body.reply.length).toBeLessThan(260);
    const t = await api(r.token).post(`/api/agents/${id}/test-chat`, { message: 'wait are you a real person?', state: s.body.state });
    expect(t.body.reply).toMatch(/AI assistant/);
    expect(t.body.reply).not.toMatch(/I am (a )?human|real person here/i);
  });
});
