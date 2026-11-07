import { describe, it, expect } from 'vitest';
import { useDb, register, api } from '../helpers.js';
import { drain } from '../../src/queue/queue.js';
import { Lead, CampaignLead } from '../../src/models/index.js';
import { expandLocation, GEO } from '../../src/lib/geo.js';

useDb();

describe('campaign targeting by country → state → city', () => {
  it('expands a state-only target into a real city in that state', () => {
    const tx = expandLocation('Texas, USA', 2);
    expect(tx.region).toBe('Texas');
    expect(GEO[0].regions.Texas).toContain(tx.city);
    expect(expandLocation('Manchester, North West England, United Kingdom', 0)).toMatchObject({ city: 'Manchester', region: 'North West England', country: 'United Kingdom' });
    expect(expandLocation('Austin, USA', 0)).toMatchObject({ city: 'Austin', region: 'Texas', country: 'USA' });
  });
  it('serves the place list and finds prospects in the picked state', async () => {
    const r = await register();
    const geo = (await api(r.token).get('/api/lead-generation/geo')).body.countries;
    expect(geo.find((c: any) => c.name === 'USA').regions.Florida).toContain('Miami');
    await api(r.token).post('/api/lead-generation/runs', { provider: 'sandbox', limit: 12, category: 'Salons', keywords: ['hair salon'], locations: ['Florida, USA'] });
    await drain();
    const leads = (await api(r.token).get('/api/leads?limit=50')).body.items;
    expect(leads.length).toBeGreaterThan(5);
    expect(leads.every((l: any) => l.location?.state === 'Florida' && GEO[0].regions.Florida.includes(l.location.city))).toBe(true);
  });
});

describe('existing-lead picker', () => {
  it('returns callable leads with their category, result and the campaign that contacted them', async () => {
    const r = await register();
    const mk = async (name: string, phone: string, category: string) => { const l = await api(r.token).post('/api/leads', { companyName: name, phone, category }); await api(r.token).post('/api/leads/bulk', { ids: [l.body._id], action: 'approve' }); return l.body._id; };
    const a = await mk('Fresh Salon', '+919876810001', 'Salons');
    const b = await mk('Keen Salon', '+919876810002', 'Salons');
    const c = await mk('Helping Hands', '+919876810003', 'NGO');
    const d = await mk('Queued Salon', '+919876810004', 'Salons');
    const e = await mk('Opted Out Salon', '+919876810005', 'Salons');
    const agentId = (await api(r.token).get('/api/agents')).body.agents[0]._id;
    const done = await api(r.token).post('/api/campaigns', { name: 'Salons October', category: 'Salons', agentId, leadIds: [b] });
    await CampaignLead.updateOne({ businessId: r.businessId, leadId: b }, { status: 'completed' });
    await Lead.updateOne({ businessId: r.businessId, _id: b }, { outcome: 'interested', lastContactedAt: new Date() });
    await api(r.token).post('/api/campaigns', { name: 'Running now', category: 'Salons', agentId, leadIds: [d] });
    await Lead.updateOne({ businessId: r.businessId, _id: e }, { doNotCall: true, outcome: 'do_not_call' });

    const res = await api(r.token).get('/api/leads/picker');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.items.map((l: any) => [l._id, l]));
    expect(Object.keys(byId).sort()).toEqual([a, b, c].sort());
    expect(byId[a]).toMatchObject({ category: 'Salons', outcome: 'none', contacted: false, campaigns: [] });
    expect(byId[b]).toMatchObject({ outcome: 'interested', contacted: true });
    expect(byId[b].campaigns[0]).toMatchObject({ _id: done.body._id, name: 'Salons October' });
    expect(byId[c].category).toBe('NGO');
    expect(res.body.hiddenInRunning).toBe(1);
    expect((await api(r.token).get('/api/leads/picker?search=helping')).body.items.map((l: any) => l._id)).toEqual([c]);
  });
});

describe('sales coaching scorecard', () => {
  it('grades every analysed call', async () => {
    const { clock } = await import('../../src/lib/clock.js');
    const { Call } = await import('../../src/models/index.js');
    clock.set(new Date('2026-11-09T05:30:00Z')); // Monday 11:00 IST
    try {
      const r = await register();
      const { ICP_SETTINGS } = await import('../helpers.js');
      await api(r.token).patch('/api/business', { ...ICP_SETTINGS, compliance: { callingDays: [1, 2, 3, 4, 5], callingWindowStart: '10:00', callingWindowEnd: '19:00' } });
      const l = await api(r.token).post('/api/leads', { companyName: 'Smile Dental', contactName: 'Ana Ruiz', phone: '+919876820001' });
      await api(r.token).post('/api/leads/bulk', { ids: [l.body._id], action: 'approve' });
      await Lead.collection.updateOne({ _id: (await import('mongoose')).Types.ObjectId.createFromHexString(l.body._id) }, { $set: { tags: ['sim:skeptic'] } });
      await api(r.token).post('/api/calls', { leadId: l.body._id });
      await drain();
      const call: any = await Call.findOne({ businessId: r.businessId, leadId: l.body._id }).lean();
      expect(call.scorecard).toBeTruthy();
      expect(call.scorecard.checks.find((c: any) => c.key === 'disclosure').passed).toBe(true);
      expect(call.scorecard.checks.find((c: any) => c.key === 'reason').passed).toBe(true);
      expect(call.scorecard.score).toBeGreaterThanOrEqual(70);
      const detail = (await api(r.token).get(`/api/calls/${call._id}`)).body;
      expect(detail.scorecard?.grade ?? detail.call?.scorecard?.grade).toMatch(/[ABCD]/);
    } finally { clock.set(null); }
  });
});

describe('the agent decides the pitch per campaign (no settings)', () => {
  it('campaign page shows the pitch for its category; test call can practise as that campaign', async () => {
    const r = await register();
    const { ICP_SETTINGS } = await import('../helpers.js');
    await api(r.token).patch('/api/business', { ...ICP_SETTINGS, description: 'PixelForge builds fast, mobile-friendly websites and handles SEO for small organisations.', products: [{ name: 'Website rebuild', description: 'A modern, mobile-friendly website with SEO' }] });
    const agentId = (await api(r.token).get('/api/agents')).body.agents[0]._id;
    const c = await api(r.token).post('/api/campaigns', { name: 'NGOs in Texas', category: 'NGO', agentId });
    const detail = (await api(r.token).get(`/api/campaigns/${c.body._id}`)).body;
    expect(detail.pitch.audience).toBe('nonprofits');
    expect(detail.pitch.reason).toMatch(/donors/);
    expect(detail.pitch.pains.map((p: any) => p.pain).join(' ')).toMatch(/donating/);
    const chat = await api(r.token).post(`/api/agents/${agentId}/test-chat`, { campaignId: c.body._id });
    expect(chat.body.reply).toMatch(/nonprofits/);
    const b = (await api(r.token).get('/api/business')).body;
    expect(b.salesPlaybook).toBeUndefined();
  });
});
