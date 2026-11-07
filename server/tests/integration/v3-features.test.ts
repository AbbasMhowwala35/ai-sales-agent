import { describe, it, expect } from 'vitest';
import { useDb, register, api, ICP_SETTINGS } from '../helpers.js';
import { drain } from '../../src/queue/queue.js';
import { clock } from '../../src/lib/clock.js';
import { Lead, CampaignLead } from '../../src/models/index.js';
import { gradeHtml, computePriority, auditWebsite } from '../../src/services/leads/priority.js';

useDb();
const IST_11AM_MON = new Date('2026-11-09T05:30:00Z');
const WEB_RULES = [
  { priority: 1, signal: 'no_website', label: 'No website' },
  { priority: 2, signal: 'weak_website', label: 'Basic website' },
  { priority: 3, signal: 'good_website', label: 'Good website — maintenance' },
];

describe('lead priority by need', () => {
  it('grades websites: modern vs basic', () => {
    const modern = `<html><head><title>Luxe</title><meta name="description" content="x"><meta name="viewport" content="width=device-width"></head><body>${'Great salon. '.repeat(60)}<a href="https://booksy.com/luxe">Book now</a><form><input name="email"></form><p>© ${new Date().getFullYear()} Luxe</p></body></html>`;
    const basic = `<html><body><table width=600><tr><td><font>Welcome</font></td></tr></table><center>Call us</center><font>x</font><font>y</font><p>© 2016</p></body></html>`;
    const g = gradeHtml(modern, 'https://luxe.com');
    const b = gradeHtml(basic, 'http://old.com');
    expect(g.score).toBeGreaterThanOrEqual(80);
    expect(g.onlineBooking).toBe(true);
    expect(b.score).toBeLessThan(40);
    expect(b.issues).toEqual(expect.arrayContaining(['Not mobile-friendly', 'No HTTPS (shows “Not secure”)']));
  });
  it('assigns P1/P2/P3 for a website-development business', async () => {
    expect(computePriority({ companyName: 'A', websiteAudit: await auditWebsite(undefined) }, WEB_RULES)).toMatchObject({ priority: 1 });
    expect(computePriority({ companyName: 'B', websiteAudit: { hasWebsite: true, reachable: true, score: 35 } }, WEB_RULES)).toMatchObject({ priority: 2, reason: 'Basic website' });
    expect(computePriority({ companyName: 'C', websiteAudit: { hasWebsite: true, reachable: true, score: 90 } }, WEB_RULES)).toMatchObject({ priority: 3 });
  });
  it('prioritises newly discovered leads, stores them by category, and lists categories', async () => {
    const r = await register();
    await api(r.token).patch('/api/business', { ...ICP_SETTINGS, priorityRules: WEB_RULES });
    expect((await api(r.token).post('/api/lead-generation/runs', { provider: 'sandbox', limit: 20, category: 'Salons', keywords: ['hair salon'], locations: ['Austin, TX'] })).status).toBe(202);
    await drain();
    const leads = (await api(r.token).get('/api/leads?limit=100&sort=priority')).body.items;
    expect(leads.length).toBeGreaterThan(5);
    expect(leads.every((l: any) => l.category === 'Salons')).toBe(true);
    expect(leads.every((l: any) => [1, 2, 3].includes(l.priority))).toBe(true);
    expect(leads[0].priority).toBe(1);
    expect(leads.at(-1).priority).toBeGreaterThanOrEqual(leads[0].priority);
    const cats = (await api(r.token).get('/api/leads/categories')).body.categories;
    expect(cats[0]).toMatchObject({ name: 'Salons' });
    expect(cats[0].p1 + cats[0].p2 + cats[0].p3).toBe(cats[0].total);
    expect((await api(r.token).get('/api/leads?priority=1')).body.items.every((l: any) => l.priority === 1)).toBe(true);
  });
  it('“available” leads exclude closed outcomes and leads queued in another campaign', async () => {
    const r = await register();
    const mk = async (name: string, phone: string) => { const l = await api(r.token).post('/api/leads', { companyName: name, phone, category: 'Dentists' }); await api(r.token).post('/api/leads/bulk', { ids: [l.body._id], action: 'approve' }); return l.body._id; };
    const a = await mk('Open Dental', '+919876800001'), b = await mk('Closed Dental', '+919876800002'), c = await mk('Busy Dental', '+919876800003');
    await Lead.updateOne({ businessId: r.businessId, _id: b }, { outcome: 'not_interested' });
    const agentId = (await api(r.token).get('/api/agents')).body.agents[0]._id;
    await api(r.token).post('/api/campaigns', { name: 'Other campaign', category: 'Dentists', agentId, leadIds: [c] });
    const avail = (await api(r.token).get('/api/leads?available=true&approval=approved&category=Dentists')).body.items.map((l: any) => l._id);
    expect(avail).toEqual([a]);
    expect(await CampaignLead.countDocuments({ businessId: r.businessId })).toBe(1);
  });
});

describe('meeting brief, CSV sample and calendar', () => {
  it('builds a meeting brief from the call: pains, what was offered, talking points', async () => {
    clock.set(IST_11AM_MON);
    const r = await register();
    await api(r.token).patch('/api/business', { ...ICP_SETTINGS, compliance: { callingDays: [1, 2, 3, 4, 5], callingWindowStart: '10:00', callingWindowEnd: '19:00' } });
    const l = await api(r.token).post('/api/leads', { companyName: 'Brief Co', phone: '+919876800010', contactName: 'Asha' });
    await api(r.token).post('/api/leads/bulk', { ids: [l.body._id], action: 'approve' });
    await Lead.updateOne({ businessId: r.businessId, _id: l.body._id }, { tags: ['sim:interested'] });
    await api(r.token).post('/api/calls', { leadId: l.body._id });
    await drain();
    const lead = (await api(r.token).get(`/api/leads/${l.body._id}`)).body.lead;
    expect(lead.brief.summary).toBeTruthy();
    expect(lead.brief.pains.length).toBeGreaterThan(0);
    expect(lead.brief.offered.length).toBeGreaterThan(0);
    expect(lead.brief.talkingPoints.length).toBeGreaterThan(0);
    expect(lead.brief.callId).toBeTruthy();
  });
  it('serves a sample import CSV that imports cleanly with categories', async () => {
    const r = await register();
    const csv = await api(r.token).get('/api/lead-generation/sample.csv');
    expect(csv.text.split('\n')[0]).toMatch(/^company,name,title,phone,email,website/);
    const imp = await api(r.token).post('/api/lead-generation/import').attach('file', Buffer.from(csv.text), 'sample.csv');
    expect(imp.body.created).toBe(3);
    const cats = (await api(r.token).get('/api/leads/categories')).body.categories.map((c: any) => c.name).sort();
    expect(cats).toEqual(['Salons', 'Spas']);
  });
  it('calendar: shows booked meetings with who they’re with; Google connect explains missing setup', async () => {
    const r = await register();
    const st = (await api(r.token).get('/api/integrations/google/status')).body;
    expect(st).toMatchObject({ configured: false, connected: false });
    const c = await api(r.token).post('/api/integrations/google/connect', {});
    expect(c.status).toBe(400);
    expect(c.body.error.message).toMatch(/GOOGLE_CALENDAR_CLIENT_ID/);
    const ev = await api(r.token).get(`/api/integrations/calendar/events?from=${new Date(Date.now() - 86400_000).toISOString()}&to=${new Date(Date.now() + 30 * 86400_000).toISOString()}`);
    expect(ev.status).toBe(200);
    expect(ev.body).toMatchObject({ connected: false, appointments: [], googleEvents: [] });
  });
});
