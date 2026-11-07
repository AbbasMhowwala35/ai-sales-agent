import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import request from 'supertest';
import { app, useDb, register, api, ICP_SETTINGS, BUSINESS_HOURS_IST } from '../helpers.js';
import { drain } from '../../src/queue/queue.js';
import { schedulerTick } from '../../src/services/campaigns/scheduler.js';
import { clock } from '../../src/lib/clock.js';
import { setTelephony } from '../../src/providers/telephony/index.js';
import { Call, CampaignLead, DncEntry, Lead, Appointment } from '../../src/models/index.js';

useDb();

async function setupBusiness(leads: { name: string; phone: string; tags?: string[]; email?: string }[]) {
  const r = await register();
  await api(r.token).patch('/api/business', { ...ICP_SETTINGS, compliance: { callingDays: [0, 1, 2, 3, 4, 5, 6], callingWindowStart: '09:00', callingWindowEnd: '20:00' } });
  const ids: string[] = [];
  for (const l of leads) {
    const res = await api(r.token).post('/api/leads', { companyName: l.name, contactName: 'Priya Sharma', phone: l.phone, email: l.email, industry: 'Retail', city: 'Mumbai', country: 'India' });
    expect(res.status).toBe(201);
    if (l.tags) await Lead.updateOne({ businessId: r.businessId, _id: res.body._id }, { tags: l.tags });
    ids.push(res.body._id);
  }
  await api(r.token).post('/api/leads/bulk', { ids, action: 'approve' });
  const agent = (await api(r.token).get('/api/agents')).body.agents[0];
  return { ...r, leadIds: ids, agentId: agent._id };
}

async function runCampaign(token: string, body: any) {
  const c = await api(token).post('/api/campaigns', { name: 'Q4 Outreach', schedule: { timezone: 'Asia/Kolkata', days: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '20:00' }, ...body });
  expect(c.status).toBe(201);
  return c.body;
}

async function cycle(times = 6) {
  for (let i = 0; i < times; i++) { await schedulerTick(); await drain(); }
}

describe('AI calling campaigns (simulator provider)', () => {
  it('runs a campaign end-to-end: dial → conversation → transcript → analysis → booking → lead pipeline', async () => {
    clock.set(BUSINESS_HOURS_IST);
    const s = await setupBusiness([{ name: 'Happy Path Retail', phone: '+919876600001', tags: ['sim:interested'], email: 'priya@happy.in' }]);
    const c = await runCampaign(s.token, { agentId: s.agentId, leadIds: s.leadIds, objective: 'customer follow-up automation' });
    expect(c.added).toBe(1);
    expect((await api(s.token).post(`/api/campaigns/${c._id}/start`)).status).toBe(200);
    await cycle(3);
    const calls = (await api(s.token).get('/api/calls')).body.items;
    expect(calls).toHaveLength(1);
    const call = (await api(s.token).get(`/api/calls/${calls[0]._id}`)).body;
    expect(call.result).toBe('answered');
    expect(call.durationSec).toBeGreaterThan(10);
    expect(call.transcript.segments.length).toBeGreaterThan(6);
    expect(call.transcript.segments[0].speaker).toBe('agent');
    expect(call.transcript.segments[0].text).toMatch(/AI assistant/);
    expect(call.analysisStatus).toBe('done');
    expect(call.summary).toMatch(/interest/i);
    expect(call.sentiment.label).toBeDefined();
    expect(call.qualification.intent).toBe('high');
    expect(call.nextAction).toBeTruthy();
    expect(call.appointmentId).toBeTruthy();
    const lead = (await api(s.token).get(`/api/leads/${s.leadIds[0]}`)).body;
    expect(lead.lead.status).toBe('meeting_scheduled');
    expect(lead.appointments).toHaveLength(1);
    expect(lead.activities.map((a: any) => a.type)).toEqual(expect.arrayContaining(['call', 'appointment']));
    const appts = await api(s.token).get('/api/calls/appointments');
    expect(appts.body.items[0].type).toBe('meeting');
    const { sentEmails } = await import('../../src/providers/email/index.js');
    expect(sentEmails.some((e) => e.to === 'priya@happy.in' && e.attachments?.[0].filename === 'invite.ics')).toBe(true);
    const camp = (await api(s.token).get(`/api/campaigns/${c._id}`)).body;
    expect(camp.status).toBe('completed');
    const notifs = (await api(s.token).get('/api/notifications')).body;
    expect(notifs.items.map((n: any) => n.title)).toEqual(expect.arrayContaining(['Meeting booked by AI agent']));
  });

  it('honours opt-outs: adds number to DNC, marks lead, never calls again', async () => {
    clock.set(BUSINESS_HOURS_IST);
    const s = await setupBusiness([{ name: 'Opt Out Co', phone: '+919876600002', tags: ['sim:opt_out'] }]);
    const c = await runCampaign(s.token, { agentId: s.agentId, leadIds: s.leadIds });
    await api(s.token).post(`/api/campaigns/${c._id}/start`);
    await cycle(2);
    const call = await Call.findOne({ businessId: s.businessId });
    expect(call!.optOut).toBe(true);
    expect(await DncEntry.countDocuments({ businessId: s.businessId })).toBe(1);
    const lead = await Lead.findOne({ businessId: s.businessId, _id: s.leadIds[0] });
    expect(lead!.doNotCall).toBe(true);
    // manual call attempt is blocked by compliance
    const manual = await api(s.token).post('/api/calls', { leadId: s.leadIds[0] });
    expect(manual.status).toBe(400);
    expect(manual.body.error.message).toMatch(/Do-Not-Call|opted out/);
    // opt-out DNC entries can't be deleted
    const dnc = (await api(s.token).get('/api/compliance/dnc')).body.items[0];
    expect((await api(s.token).delete(`/api/compliance/dnc/${dnc._id}`)).status).toBe(400);
  });

  it('retries missed calls up to maxRetries, then marks exhausted', async () => {
    clock.set(BUSINESS_HOURS_IST);
    const s = await setupBusiness([{ name: 'Never Answers', phone: '+919876600003', tags: ['sim:missed'] }]);
    await api(s.token).patch('/api/business', { compliance: { maxAttemptsPerLead: 5, callingDays: [0, 1, 2, 3, 4, 5, 6], callingWindowStart: '09:00', callingWindowEnd: '20:00' } });
    const c = await runCampaign(s.token, { agentId: s.agentId, leadIds: s.leadIds, maxRetries: 2, retryDelayMinutes: 30 });
    await api(s.token).post(`/api/campaigns/${c._id}/start`);
    await cycle(2);
    let cl = await CampaignLead.findOne({ businessId: s.businessId });
    expect(cl!.status).toBe('retry');
    expect(cl!.attempts).toBe(1);
    await cycle(2); // retry not yet due
    expect(await Call.countDocuments({ businessId: s.businessId })).toBe(1);
    clock.set(new Date(BUSINESS_HOURS_IST.getTime() + 31 * 60_000));
    await cycle(2);
    clock.set(new Date(BUSINESS_HOURS_IST.getTime() + 62 * 60_000));
    await cycle(2);
    cl = await CampaignLead.findOne({ businessId: s.businessId });
    expect(await Call.countDocuments({ businessId: s.businessId })).toBe(3);
    expect(cl!.status).toBe('exhausted');
    const missed = (await api(s.token).get('/api/calls?result=missed')).body;
    expect(missed.total).toBe(3);
  });

  it('never dials outside the calling window (TRAI 09:00–21:00 and business hours)', async () => {
    clock.set(new Date('2026-11-09T17:00:00Z')); // 22:30 IST
    const s = await setupBusiness([{ name: 'Night Owl', phone: '+919876600004' }]);
    const c = await runCampaign(s.token, { agentId: s.agentId, leadIds: s.leadIds, schedule: { timezone: 'Asia/Kolkata', days: [0, 1, 2, 3, 4, 5, 6], startTime: '00:00', endTime: '23:59' } });
    await api(s.token).post(`/api/campaigns/${c._id}/start`);
    await cycle(2);
    expect(await Call.countDocuments({ businessId: s.businessId })).toBe(0);
    const manual = await api(s.token).post('/api/calls', { leadId: s.leadIds[0] });
    expect(manual.status).toBe(400);
    expect(manual.body.error.message).toMatch(/legal calling hours/);
    const cl = await CampaignLead.findOne({ businessId: s.businessId });
    expect(cl!.status).toBe('queued');
    expect(cl!.attempts).toBe(0);
  });

  it('pauses and resumes a campaign; paused campaigns place no new calls', async () => {
    clock.set(BUSINESS_HOURS_IST);
    const leads = Array.from({ length: 6 }, (_, i) => ({ name: `Pause Co ${i}`, phone: `+91987660010${i}`, tags: ['sim:not_interested'] }));
    const s = await setupBusiness(leads);
    const c = await runCampaign(s.token, { agentId: s.agentId, leadIds: s.leadIds, maxConcurrent: 2 });
    await api(s.token).post(`/api/campaigns/${c._id}/start`); // dispatches first 2
    expect((await api(s.token).post(`/api/campaigns/${c._id}/pause`)).body.status).toBe('paused');
    await drain(); // queued dials see the pause and stand down
    await cycle(3);
    const afterPause = await Call.countDocuments({ businessId: s.businessId, result: 'answered' });
    expect(afterPause).toBe(0);
    expect(await CampaignLead.countDocuments({ businessId: s.businessId, status: 'queued' })).toBe(6);
    expect((await api(s.token).post(`/api/campaigns/${c._id}/pause`)).status).toBe(400); // invalid transition
    expect((await api(s.token).post(`/api/campaigns/${c._id}/resume`)).body.status).toBe('active');
    clock.set(new Date(BUSINESS_HOURS_IST.getTime() + 11 * 60_000));
    await cycle(6);
    expect(await Call.countDocuments({ businessId: s.businessId, result: 'answered' })).toBe(6);
    expect((await api(s.token).get(`/api/campaigns/${c._id}`)).body.status).toBe('completed');
  });

  it('respects daily limits and max concurrency, and never double-dials under concurrent schedulers', async () => {
    clock.set(BUSINESS_HOURS_IST);
    const leads = Array.from({ length: 12 }, (_, i) => ({ name: `Bulk ${i}`, phone: `+9198766002${String(i).padStart(2, '0')}`, tags: ['sim:busy'] }));
    const s = await setupBusiness(leads);
    const c = await runCampaign(s.token, { agentId: s.agentId, leadIds: s.leadIds, maxConcurrent: 3, dailyLimit: 5, maxRetries: 0 });
    await Promise.all([api(s.token).post(`/api/campaigns/${c._id}/start`), schedulerTick(), schedulerTick(), schedulerTick()]);
    const inFlight = await Call.countDocuments({ businessId: s.businessId, status: { $ne: 'ended' } });
    expect(inFlight).toBeLessThanOrEqual(3);
    await drain();
    await Promise.all([schedulerTick(), schedulerTick(), schedulerTick()]);
    await drain();
    await cycle(3);
    expect(await Call.countDocuments({ businessId: s.businessId })).toBe(5); // daily limit
    const perLead = await Call.aggregate([{ $match: { businessId: (await import('mongoose')).Types.ObjectId.createFromHexString(s.businessId) } }, { $group: { _id: '$leadId', n: { $sum: 1 } } }]);
    expect(perLead.every((x) => x.n === 1)).toBe(true);
  });

  it('only approved leads can be added to campaigns', async () => {
    clock.set(BUSINESS_HOURS_IST);
    const s = await setupBusiness([{ name: 'Approved', phone: '+919876600301' }]);
    const pending = await api(s.token).post('/api/leads', { companyName: 'Pending Co', phone: '+919876600302' });
    const c = await runCampaign(s.token, { agentId: s.agentId, leadIds: [...s.leadIds, pending.body._id] });
    expect(c.added).toBe(1);
    expect(c.skipped).toBe(1);
  });
});

describe('Twilio integration (webhooks)', () => {
  let rec: http.Server; let recUrl = '';
  beforeAll(async () => {
    rec = http.createServer((_q, r) => { r.setHeader('content-type', 'audio/mpeg'); r.end(Buffer.alloc(32000, 7)); });
    await new Promise<void>((ok) => rec.listen(0, () => { recUrl = `http://127.0.0.1:${(rec.address() as any).port}/rec.mp3`; ok(); }));
  });
  afterAll(() => rec.close());

  const sign = (path: string, params: Record<string, string>) => {
    const url = `https://api.example.test${path}`;
    const data = Object.keys(params).sort().reduce((a, k) => a + k + params[k], url);
    return crypto.createHmac('sha1', 'test_twilio_token').update(data).digest('base64');
  };
  const post = (path: string, params: Record<string, string>, sig = true) => request(app).post(path).type('form').set('X-Twilio-Signature', sig ? sign(path, params) : 'bad').send(params);

  it('runs a live turn-based call via TwiML, finalises on status, downloads and streams the recording with access control', async () => {
    clock.set(BUSINESS_HOURS_IST);
    const dialed: any[] = [];
    setTelephony({ id: 'twilio', dial: async (req) => { dialed.push(req); return { providerCallId: 'CA123' }; } });
    const s = await setupBusiness([{ name: 'Twilio Lead', phone: '+919876600401' }]);
    const created = await api(s.token).post('/api/calls', { leadId: s.leadIds[0] });
    expect(created.status).toBe(202);
    await drain();
    expect(dialed).toHaveLength(1);
    expect(dialed[0].to).toBe('+919876600401');
    const callId = created.body._id;
    const base = `/api/webhooks/twilio`;
    expect((await post(`${base}/voice/${callId}`, { CallSid: 'CA123' }, false)).status).toBe(403); // bad signature
    const voice = await post(`${base}/voice/${callId}`, { CallSid: 'CA123', AnsweredBy: 'human' });
    expect(voice.text).toMatch(/<Gather input="speech"/);
    expect(voice.text).toMatch(/AI assistant/);
    const t1 = await post(`${base}/gather/${callId}`, { CallSid: 'CA123', SpeechResult: 'Yes go ahead' });
    expect(t1.text).toMatch(/<Say/);
    const t2 = await post(`${base}/gather/${callId}`, { CallSid: 'CA123', SpeechResult: 'How much does it cost?' });
    expect(t2.text).toMatch(/4,999/);
    const t3 = await post(`${base}/gather/${callId}`, { CallSid: 'CA123', SpeechResult: 'Please do not call me again' });
    expect(t3.text).toMatch(/<Hangup\/>/);
    await post(`${base}/status/${callId}`, { CallSid: 'CA123', CallStatus: 'completed', CallDuration: '74' });
    await post(`${base}/recording/${callId}`, { CallSid: 'CA123', RecordingStatus: 'completed', RecordingUrl: recUrl });
    await drain();
    const call = (await api(s.token).get(`/api/calls/${callId}`)).body;
    expect(call.result).toBe('answered');
    expect(call.durationSec).toBe(74);
    expect(call.optOut).toBe(true);
    expect(call.transcript.segments.map((x: any) => x.speaker)).toEqual(['agent', 'customer', 'agent', 'customer', 'agent', 'customer', 'agent']);
    expect(call.recording.status).toBe('available');
    // listen via signed URL with Range support
    const u = await api(s.token).post(`/api/calls/${callId}/recording-url`, {});
    const partial = await request(app).get(u.body.url).set('Range', 'bytes=0-999');
    expect(partial.status).toBe(206);
    expect(partial.headers['content-range']).toBe('bytes 0-999/32000');
    const full = await request(app).get(u.body.url);
    expect(full.status).toBe(200);
    expect(Number(full.headers['content-length'])).toBe(32000);
    // token is bound to the call
    expect((await request(app).get(u.body.url.replace(callId, s.leadIds[0]))).status).toBe(403);
    expect((await request(app).get(`/api/media/recordings/${callId}?token=forged`)).status).toBe(401);
    // viewer cannot listen; agent can listen but not download
    const mk = async (role: string) => {
      const inv = await api(s.token).post('/api/team/invite', { email: `${role}_${Date.now()}@x.test`, role });
      return (await request(app).post('/api/auth/accept-invite').send({ token: new URL(inv.body.inviteLink).searchParams.get('token'), name: role, password: 'Passw0rd!' })).body.token;
    };
    const viewer = await mk('viewer'); const agent = await mk('agent');
    expect((await api(viewer).post(`/api/calls/${callId}/recording-url`, {})).status).toBe(403);
    expect((await api(agent).post(`/api/calls/${callId}/recording-url`, {})).status).toBe(200);
    expect((await api(agent).post(`/api/calls/${callId}/recording-url`, { download: true })).status).toBe(403);
    const dl = await api(s.token).post(`/api/calls/${callId}/recording-url`, { download: true });
    expect((await request(app).get(dl.body.url)).headers['content-disposition']).toMatch(/attachment/);
  });

  it('maps busy / no-answer / voicemail statuses', async () => {
    clock.set(BUSINESS_HOURS_IST);
    setTelephony({ id: 'twilio', dial: async () => ({ providerCallId: 'CA9' }) });
    const s = await setupBusiness([{ name: 'B1', phone: '+919876600501' }, { name: 'B2', phone: '+919876600502' }, { name: 'B3', phone: '+919876600503' }]);
    const ids: string[] = [];
    for (const leadId of s.leadIds) ids.push((await api(s.token).post('/api/calls', { leadId })).body._id);
    await drain();
    await post(`/api/webhooks/twilio/status/${ids[0]}`, { CallStatus: 'busy' });
    await post(`/api/webhooks/twilio/status/${ids[1]}`, { CallStatus: 'no-answer' });
    await post(`/api/webhooks/twilio/voice/${ids[2]}`, { AnsweredBy: 'machine_start' });
    const results = await Promise.all(ids.map(async (id) => (await Call.findById(id).setOptions({ crossTenant: true }))!.result));
    expect(results).toEqual(['busy', 'missed', 'voicemail']);
  });
});

describe('Vapi integration (webhooks)', () => {
  it('serves knowledge/booking/opt-out tools and ingests end-of-call reports', async () => {
    clock.set(BUSINESS_HOURS_IST);
    setTelephony({ id: 'vapi', dial: async () => ({ providerCallId: 'vapi-1' }) });
    const s = await setupBusiness([{ name: 'Vapi Lead', phone: '+919876600601' }]);
    const callId = (await api(s.token).post('/api/calls', { leadId: s.leadIds[0] })).body._id;
    await drain();
    const hook = (message: any, secret = 'vapi_test_secret') => request(app).post('/api/webhooks/vapi').set('x-vapi-secret', secret).send({ message: { ...message, call: { metadata: { callId } } } });
    expect((await hook({ type: 'status-update', status: 'in-progress' }, 'wrong')).status).toBe(403);
    await hook({ type: 'status-update', status: 'in-progress' });
    const tools = await hook({ type: 'tool-calls', toolCallList: [
      { id: 't1', function: { name: 'search_knowledge_base', arguments: { query: 'How much does Acme CRM cost?' } } },
      { id: 't2', function: { name: 'book_meeting', arguments: JSON.stringify({ time_text: 'tomorrow at 4 pm', kind: 'meeting' }) } },
    ] });
    expect(tools.body.results[0].result).toMatch(/4,999/);
    expect(tools.body.results[1].result).toMatch(/Booked/);
    expect(await Appointment.countDocuments({ businessId: s.businessId })).toBe(1);
    await hook({ type: 'end-of-call-report', endedReason: 'customer-ended-call', durationSeconds: 95, artifact: { recordingUrl: undefined, messages: [
      { role: 'bot', message: 'Hi, this is Aria, an AI assistant from Acme.', secondsFromStart: 0, duration: 3000 },
      { role: 'user', message: 'Sounds interesting, we are looking for a CRM.', secondsFromStart: 4, duration: 2500 },
    ] } });
    await drain();
    const call = (await api(s.token).get(`/api/calls/${callId}`)).body;
    expect(call.result).toBe('answered');
    expect(call.durationSec).toBe(95);
    expect(call.transcript.segments).toHaveLength(2);
    expect(call.analysisStatus).toBe('done');
  });
});

describe('analytics', () => {
  it('aggregates leads, calls, outcomes, campaigns and agent performance for a date range', async () => {
    clock.set(BUSINESS_HOURS_IST);
    const s = await setupBusiness([
      { name: 'A1', phone: '+919876600701', tags: ['sim:interested'] },
      { name: 'A2', phone: '+919876600702', tags: ['sim:missed'] },
      { name: 'A3', phone: '+919876600703', tags: ['sim:not_interested'] },
    ]);
    const c = await runCampaign(s.token, { agentId: s.agentId, leadIds: s.leadIds, maxRetries: 0 });
    await api(s.token).post(`/api/campaigns/${c._id}/start`);
    await cycle(3);
    const from = new Date(Date.now() - 86400_000).toISOString(), to = new Date(Date.now() + 86400_000).toISOString();
    const a = (await api(s.token).get(`/api/analytics?from=${from}&to=${to}`)).body;
    expect(a.summary.leadsDiscovered).toBe(3);
    expect(a.summary.callsInitiated).toBe(3);
    expect(a.summary.connected).toBe(2);
    expect(a.summary.missed).toBe(1);
    expect(a.summary.meetingsScheduled).toBe(1);
    expect(a.summary.interested).toBeGreaterThanOrEqual(1);
    expect(a.summary.avgCallDuration).toBeGreaterThan(0);
    expect(a.campaigns[0]).toMatchObject({ name: 'Q4 Outreach', calls: 3, answered: 2 });
    expect(a.agents[0]).toMatchObject({ name: 'Aria', calls: 3 });
    expect(a.funnel.find((f: any) => f.stage === 'meeting_scheduled').count).toBe(1);
    expect((await api(s.token).get('/api/analytics?from=2026-01-01&to=2025-01-01')).status).toBe(400);
  });
});
