import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, useDb, register, api } from '../helpers.js';
import { Lead, User } from '../../src/models/index.js';

useDb();

describe('registration & authentication', () => {
  it('registers a business with an owner, default AI agent and profile knowledge', async () => {
    const r = await register({ businessName: 'Zen Clinics' });
    const me = await api(r.token).get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('owner');
    expect(me.body.business.name).toBe('Zen Clinics');
    const agents = await api(r.token).get('/api/agents');
    expect(agents.body.agents).toHaveLength(1);
    expect(agents.body.agents[0].isDefault).toBe(true);
  });
  it('rejects weak passwords, bad emails and duplicate accounts', async () => {
    const weak = await request(app).post('/api/auth/register').send({ name: 'A B', email: 'a@b.co', password: 'short', businessName: 'X Co' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.details.length).toBeGreaterThan(0);
    const r = await register();
    const dup = await request(app).post('/api/auth/register').send({ name: 'A B', email: r.email, password: 'Passw0rd!', businessName: 'Y Co' });
    expect(dup.status).toBe(409);
  });
  it('logs in, rejects bad password, locks after 5 failures', async () => {
    const r = await register();
    expect((await request(app).post('/api/auth/login').send({ email: r.email, password: 'Passw0rd!' })).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await request(app).post('/api/auth/login').send({ email: r.email, password: 'wrong-pass1' })).status).toBe(401);
    const locked = await request(app).post('/api/auth/login').send({ email: r.email, password: 'Passw0rd!' });
    expect(locked.status).toBe(423);
    await User.updateOne({ email: r.email }, { $unset: { lockedUntil: 1 } });
  });
  it('requires a valid token', async () => {
    expect((await request(app).get('/api/leads')).status).toBe(401);
    expect((await request(app).get('/api/leads').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });
  it('never returns password hashes', async () => {
    const r = await register();
    const team = await api(r.token).get('/api/team');
    expect(JSON.stringify(team.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});

describe('API hardening', () => {
  it('blocks NoSQL operator injection on login', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } });
    expect(res.status).toBe(400);
  });
  it('returns structured errors for malformed JSON, bad ids and unknown routes', async () => {
    const r = await register();
    const bad = await request(app).post('/api/leads').set('Authorization', `Bearer ${r.token}`).set('content-type', 'application/json').send('{"x":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BAD_JSON');
    expect((await api(r.token).get('/api/leads/not-an-id')).status).toBe(400);
    expect((await api(r.token).get('/api/nope')).status).toBe(404);
  });
  it('sets security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('multi-tenant isolation', () => {
  it('a business can never read or modify another business’s data', async () => {
    const a = await register({ businessName: 'Tenant A' });
    const b = await register({ businessName: 'Tenant B' });
    const created = await api(a.token).post('/api/leads', { companyName: 'Secret Client', phone: '+919876500011' });
    expect(created.status).toBe(201);
    const id = created.body._id;
    expect((await api(b.token).get(`/api/leads/${id}`)).status).toBe(404);
    expect((await api(b.token).patch(`/api/leads/${id}`, { status: 'lost' })).status).toBe(404);
    expect((await api(b.token).get('/api/leads')).body.total).toBe(0);
    const bulk = await api(b.token).post('/api/leads/bulk', { ids: [id], action: 'delete' });
    expect(bulk.body.modified).toBe(0);
    expect((await api(a.token).get(`/api/leads/${id}`)).status).toBe(200);
  });
  it('knowledge retrieval is isolated per business', async () => {
    const a = await register();
    const b = await register();
    await api(a.token).patch('/api/business', { faqs: [{ question: 'What is the secret discount code?', answer: 'The discount code is ZEBRA42 for partners only.' }] });
    const qa = await api(a.token).post('/api/knowledge/query', { question: 'What is the secret discount code?' });
    expect(qa.body.answer).toContain('ZEBRA42');
    const qb = await api(b.token).post('/api/knowledge/query', { question: 'What is the secret discount code?' });
    expect(JSON.stringify(qb.body)).not.toContain('ZEBRA42');
  });
  it('the ORM guard rejects tenant-scoped queries without businessId', async () => {
    await expect(Lead.find({})).rejects.toThrow(/Tenant isolation violation/);
    await expect(Lead.aggregate([{ $group: { _id: null } }])).rejects.toThrow(/Tenant isolation violation/);
  });
  it('stores contact PII encrypted at rest', async () => {
    const a = await register();
    const created = await api(a.token).post('/api/leads', { companyName: 'Pii Co', phone: '+919876500012', email: 'ceo@pii.co' });
    const raw = await Lead.collection.findOne({ _id: new (await import('mongoose')).Types.ObjectId(created.body._id) });
    expect(raw!.phone).toMatch(/^enc:v1:/);
    expect(raw!.email).toMatch(/^enc:v1:/);
    expect(created.body.phone).toBe('+919876500012');
  });
});

describe('team & role-based access control', () => {
  it('invites a member, who accepts and gets role-limited access', async () => {
    const owner = await register();
    const inv = await api(owner.token).post('/api/team/invite', { email: `agent_${Date.now()}@acme.test`, role: 'agent' });
    expect(inv.status).toBe(201);
    const token = new URL(inv.body.inviteLink).searchParams.get('token');
    const acc = await request(app).post('/api/auth/accept-invite').send({ token, name: 'Sam Agent', password: 'Passw0rd!' });
    expect(acc.status).toBe(200);
    const agent = acc.body.token;
    expect(acc.body.user.role).toBe('agent');
    expect((await api(agent).patch('/api/business', { name: 'Hacked' })).status).toBe(403);
    expect((await api(agent).post('/api/team/invite', { email: 'x@y.test' })).status).toBe(403);
    const lead = await api(agent).post('/api/leads', { companyName: 'Agent Lead', phone: '+919876500013' });
    expect(lead.status).toBe(201);
    expect((await api(agent).post('/api/leads/bulk', { ids: [lead.body._id], action: 'approve' })).status).toBe(403);
    // reuse of invite token fails
    expect((await request(app).post('/api/auth/accept-invite').send({ token, name: 'X Y', password: 'Passw0rd!' })).status).toBe(400);
  });
  it('disabling a member revokes access immediately', async () => {
    const owner = await register();
    const inv = await api(owner.token).post('/api/team/invite', { email: `v_${Date.now()}@acme.test`, role: 'viewer' });
    const acc = await request(app).post('/api/auth/accept-invite').send({ token: new URL(inv.body.inviteLink).searchParams.get('token'), name: 'Vee', password: 'Passw0rd!' });
    expect((await api(acc.body.token).get('/api/leads')).status).toBe(200);
    expect((await api(owner.token).patch(`/api/team/${inv.body.id}`, { status: 'disabled' })).status).toBe(200);
    expect((await api(acc.body.token).get('/api/leads')).status).toBe(403);
  });
  it('protects the last owner', async () => {
    const owner = await register();
    const team = await api(owner.token).get('/api/team');
    expect((await api(owner.token).delete(`/api/team/${team.body.members[0].id}`)).status).toBe(400);
  });
  it('writes audit logs for sensitive actions', async () => {
    const owner = await register();
    await api(owner.token).patch('/api/business', { industry: 'Retail' });
    const logs = await api(owner.token).get('/api/compliance/audit');
    expect(logs.body.items.map((l: any) => l.action)).toEqual(expect.arrayContaining(['business.updated', 'auth.register']));
  });
});
