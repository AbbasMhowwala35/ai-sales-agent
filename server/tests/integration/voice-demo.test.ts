import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { useDb, register, api } from '../helpers.js';
import { createApp } from '../../src/app.js';
const app = createApp();

useDb();

describe('free browser voice demo (shareable link)', () => {
  it('creates a link anyone can use without logging in, and rejects bad tokens', async () => {
    const r = await register({ businessName: 'PixelForge' });
    const agentId = (await api(r.token).get('/api/agents')).body.agents[0]._id;
    const link = (await api(r.token).post(`/api/agents/${agentId}/demo-link`, {})).body;
    expect(link.url).toMatch(/\/talk\/[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(link.expiresInDays).toBe(14);
    const token = link.url.split('/talk/')[1];

    const info = await request(app).get(`/api/demo/${token}`);
    expect(info.status).toBe(200);
    expect(info.body.brand).toBe('PixelForge');

    const open = await request(app).post(`/api/demo/${token}/chat`).send({});
    expect(open.status).toBe(200);
    expect(open.body.reply).toMatch(/PixelForge/);
    const next = await request(app).post(`/api/demo/${token}/chat`).send({ message: 'Sure, what is this about?', state: open.body.state });
    expect(next.status).toBe(200);
    expect(next.body.reply.length).toBeGreaterThan(10);

    const voice = await request(app).post(`/api/demo/${token}/voice`).send({ text: 'Hello there' });
    expect(voice.status).toBe(204); // no ElevenLabs key → the browser speaks it, for free

    expect((await request(app).get('/api/demo/not-a-token')).status).toBeGreaterThanOrEqual(400);
    // the login token can't be used as a demo token
    expect((await request(app).get(`/api/demo/${r.token}`)).status).toBeGreaterThanOrEqual(400);
  });
});

describe('refused calls do not use up a lead\'s attempts', () => {
  it('calls the phone company refused (never rang) are not counted toward the 3-in-7-days limit', async () => {
    const { Call } = await import('../../src/models/index.js');
    const { clock } = await import('../../src/lib/clock.js');
    clock.set(new Date('2026-11-09T06:30:00Z')); // Monday 12:00 IST
    try {
      const r = await register();
      const { ICP_SETTINGS } = await import('../helpers.js');
      await api(r.token).patch('/api/business', { ...ICP_SETTINGS, compliance: { callingDays: [1, 2, 3, 4, 5], callingWindowStart: '10:00', callingWindowEnd: '19:00' } });
      const l = await api(r.token).post('/api/leads', { companyName: 'Amy Test', phone: '+919876830001' });
      await api(r.token).post('/api/leads/bulk', { ids: [l.body._id], action: 'approve' });
      const base = { businessId: r.businessId, leadId: l.body._id, direction: 'outbound', status: 'ended', queuedAt: clock.now() };
      await Call.create([1, 2, 3].map(() => ({ ...base, result: 'failed', endReason: 'Twilio refused the call: trial accounts can’t run AI calls' })));
      const ok = await api(r.token).post('/api/calls', { leadId: l.body._id });
      expect(ok.status).toBeLessThan(300);
      // real attempts (the call reached the network) still count
      await Call.deleteMany({ businessId: r.businessId, leadId: l.body._id });
      await Call.create([1, 2, 3].map((i) => ({ ...base, result: 'missed', providerCallId: `CA${i}` })));
      const blocked = await api(r.token).post('/api/calls', { leadId: l.body._id });
      expect(blocked.status).toBe(400);
      expect(blocked.body.error.message).toMatch(/maximum of 3/);
    } finally { clock.set(null); }
  });
});
