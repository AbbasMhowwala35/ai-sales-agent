import { describe, it, expect } from 'vitest';
import { useDb, register, api, ICP_SETTINGS } from '../helpers.js';
import { drain } from '../../src/queue/queue.js';
import { ingestLeads } from '../../src/services/leads/discovery.js';
import { Business } from '../../src/models/index.js';

useDb();

describe('AI lead generation', () => {
  it('lists providers with configuration status', async () => {
    const r = await register();
    const p = await api(r.token).get('/api/lead-generation/providers');
    expect(p.body.providers.find((x: any) => x.id === 'sandbox').configured).toBe(true);
    expect(p.body.providers.find((x: any) => x.id === 'google_places').configured).toBe(false);
    const bad = await api(r.token).post('/api/lead-generation/runs', { provider: 'google_places' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/not configured/);
  });
  it('discovers, scores and stores leads matching the ICP as a background job', async () => {
    const r = await register();
    await api(r.token).patch('/api/business', ICP_SETTINGS);
    const run = await api(r.token).post('/api/lead-generation/runs', { provider: 'sandbox', limit: 30 });
    expect(run.status).toBe(202);
    await drain();
    const runs = await api(r.token).get('/api/lead-generation/runs');
    const done = runs.body.runs[0];
    expect(done.status).toBe('completed');
    expect(done.created).toBeGreaterThan(10);
    const leads = await api(r.token).get('/api/leads?limit=100&sort=-score');
    expect(leads.body.total).toBe(done.created);
    const top = leads.body.items[0];
    expect(top.score).toBeGreaterThanOrEqual(leads.body.items.at(-1).score);
    expect(top.scoreBreakdown.length).toBeGreaterThan(3);
    expect(['hot', 'warm', 'cold']).toContain(top.temperature);
    expect(leads.body.items.every((l: any) => l.approval === 'pending')).toBe(true);
    expect(leads.body.items.every((l: any) => l.tags.includes('sandbox'))).toBe(true);
    // ICP-matching leads should, on average, outscore non-matching ones
    const inIcp = leads.body.items.filter((l: any) => ['Retail', 'Healthcare'].includes(l.industry));
    const outIcp = leads.body.items.filter((l: any) => !['Retail', 'Healthcare'].includes(l.industry));
    if (outIcp.length) expect(avg(inIcp)).toBeGreaterThan(avg(outIcp));
  });
  it('prevents duplicate leads across runs and imports', async () => {
    const r = await register();
    const b = await Business.findById(r.businessId).lean();
    const raws = [
      { companyName: 'Nova Retail Pvt Ltd', contactName: 'Raj', phone: '+919876511111', email: 'raj@novaretail.in', website: 'https://novaretail.in' },
      { companyName: 'Pune Clinic', phone: '+919876522222' },
    ];
    const first = await ingestLeads(b, raws, 'sandbox');
    expect(first.created).toBe(2);
    const second = await ingestLeads(b, [
      { companyName: 'NOVA RETAIL', contactName: 'Raj', phone: '+91 98765 11111' }, // same phone
      { companyName: 'Different Name', email: 'RAJ@novaretail.in', phone: '+919876533333' }, // same email
      { companyName: 'Pune Clinic Ltd', phone: '+919876522222' }, // same phone
      { companyName: 'Brand New Co', phone: '+919876544444' },
    ], 'sandbox');
    expect(second.created).toBe(1);
    expect(second.duplicates).toBe(3);
    // CSV import path also de-duplicates
    const csv = 'Company,Name,Phone,Email\nNova Retail,Raj,+919876511111,raj@novaretail.in\nFresh Mart,Anu,+919876555555,anu@freshmart.in\nFresh Mart,Anu,+919876555555,anu@freshmart.in\n';
    const imp = await api(r.token).post('/api/lead-generation/import').attach('file', Buffer.from(csv), 'leads.csv').field('consent', 'granted');
    expect(imp.status).toBe(201);
    expect(imp.body.created).toBe(1);
    expect(imp.body.duplicates).toBe(2);
    const fresh = (await api(r.token).get('/api/leads?search=Fresh')).body.items[0];
    expect(fresh.consent).toBe('granted');
    // manual creation duplicate
    expect((await api(r.token).post('/api/leads', { companyName: 'Whatever', phone: '+919876555555' })).status).toBe(400);
  });
  it('rejects leads without a phone when phone is required, and flags DNC numbers on import', async () => {
    const r = await register();
    await api(r.token).post('/api/compliance/dnc', { phones: ['+919876566666'] });
    const b = await Business.findById(r.businessId).lean();
    const res = await ingestLeads(b, [{ companyName: 'No Phone Co' }, { companyName: 'Blocked Co', phone: '+919876566666' }], 'sandbox');
    expect(res.rejected).toBe(1);
    const blocked = (await api(r.token).get('/api/leads?search=Blocked')).body.items[0];
    expect(blocked.doNotCall).toBe(true);
  });
});

describe('leads CRM', () => {
  it('supports approval, filters, status pipeline, assignment, notes, reminders and activity history', async () => {
    const owner = await register();
    const a = await api(owner.token).post('/api/leads', { companyName: 'Alpha Stores', phone: '+919876577777', industry: 'Retail', city: 'Mumbai', country: 'India' });
    const b = await api(owner.token).post('/api/leads', { companyName: 'Beta Labs', phone: '+919876588888' });
    expect((await api(owner.token).post('/api/leads/bulk', { ids: [a.body._id], action: 'approve' })).body.modified).toBe(1);
    expect((await api(owner.token).post('/api/leads/bulk', { ids: [b.body._id], action: 'reject' })).body.modified).toBe(1);
    expect((await api(owner.token).get('/api/leads?approval=approved')).body.items.map((l: any) => l.companyName)).toEqual(['Alpha Stores']);
    expect((await api(owner.token).get('/api/leads?search=alpha')).body.total).toBe(1);
    expect((await api(owner.token).get('/api/leads?search=%2B919876577777')).body.total).toBe(1); // phone search via blind index
    const upd = await api(owner.token).patch(`/api/leads/${a.body._id}`, { status: 'interested', assignedTo: owner.userId });
    expect(upd.body.status).toBe('interested');
    expect(upd.body.assignedTo.name).toBe('Asha Owner');
    await api(owner.token).post(`/api/leads/${a.body._id}/notes`, { text: 'Owner prefers WhatsApp' });
    const rem = await api(owner.token).post(`/api/leads/${a.body._id}/reminders`, { dueAt: new Date(Date.now() + 3600_000).toISOString(), note: 'Send proposal' });
    expect(rem.status).toBe(201);
    expect((await api(owner.token).post(`/api/leads/${a.body._id}/reminders`, { dueAt: '2001-01-01' })).status).toBe(400);
    const detail = await api(owner.token).get(`/api/leads/${a.body._id}`);
    const types = detail.body.activities.map((x: any) => x.type);
    expect(types).toEqual(expect.arrayContaining(['created', 'approval', 'status_change', 'assignment', 'note', 'reminder']));
    expect(detail.body.reminders).toHaveLength(1);
    const pipe = await api(owner.token).get('/api/leads/pipeline');
    expect(pipe.body.counts.interested).toBe(1);
    expect(pipe.body.stages).toEqual(['new', 'qualified', 'contacted', 'interested', 'meeting_scheduled', 'converted', 'lost']);
    const csv = await api(owner.token).get('/api/leads/export');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Alpha Stores');
  });
  it('validates phone numbers on manual entry', async () => {
    const r = await register();
    expect((await api(r.token).post('/api/leads', { companyName: 'Bad', phone: '12' })).status).toBe(400);
  });
});

const avg = (a: any[]) => a.reduce((s, x) => s + x.score, 0) / Math.max(1, a.length);
