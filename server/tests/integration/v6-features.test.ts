import { describe, it, expect } from 'vitest';
import { useDb, register, api } from '../helpers.js';
import { drain } from '../../src/queue/queue.js';
import { humanize, draft } from '../../src/routes/assist.js';
import { FallbackEmbeddings } from '../../src/providers/embeddings/index.js';

useDb();

describe('freelancers: business name is optional', () => {
  it('signs up without a business name; the agent speaks for the owner by first name', async () => {
    const r = await register({ name: 'Abbas Mhowwala', businessName: '' });
    const me = (await api(r.token).get('/api/auth/me')).body;
    expect(me.business.name).toBe('Abbas Mhowwala'); // shown in the app instead of an empty name
    await api(r.token).patch('/api/business', { description: 'I build fast, mobile-friendly websites for small organisations.', products: [{ name: 'Website rebuild', description: 'A modern, mobile-friendly website with SEO' }] });
    const agentId = (await api(r.token).get('/api/agents')).body.agents[0]._id;
    const open = (await api(r.token).post(`/api/agents/${agentId}/test-chat`, { category: 'NGO' })).body;
    expect(open.reply).toMatch(/working with Abbas/);
    expect(open.reply).toMatch(/Abbas helps nonprofits/);
    expect(open.reply).not.toMatch(/Abbas Mhowwala.*Abbas Mhowwala/);
    const ai = (await api(r.token).post(`/api/agents/${agentId}/test-chat`, { category: 'NGO', message: 'Wait, are you a robot?', state: open.state })).body;
    expect(ai.reply).toMatch(/AI assistant working with Abbas/);
  });
  it('a business with a name still introduces itself with it', async () => {
    const r = await register({ businessName: 'PixelForge' });
    const agentId = (await api(r.token).get('/api/agents')).body.agents[0]._id;
    const open = (await api(r.token).post(`/api/agents/${agentId}/test-chat`, {})).body;
    expect(open.reply).toMatch(/PixelForge/);
  });
});

describe('AI writing helper', () => {
  it('rewrites jargon into plain, human wording and keeps the facts', () => {
    const out = humanize('We are a cutting-edge agency that leverages world-class solutions in order to empower clinics to utilize online booking!!');
    expect(out).toMatch(/^We're a modern agency that uses excellent tools to help clinics to use online booking\.$/);
  });
  it('drafts a first version from the business profile when the field is empty', () => {
    const b = { name: '', ownerName: 'Abbas Mhowwala', description: 'Websites for small organisations', products: [{ name: 'Website rebuild', description: 'A modern, mobile-friendly website with SEO' }], icp: { industries: ['NGO'] } };
    expect(draft(b, 'description')).toMatch(/^I help/);
    expect(draft(b, 'objective')).toMatch(/^helping nonprofits get found on Google/);
  });
  it('the endpoint works without an AI key (basic mode)', async () => {
    const r = await register();
    const res = await api(r.token).post('/api/assist/write', { field: 'faq_answer', text: 'we do not charge setup fees , support is available 24/7' });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('basic');
    expect(res.body.text).toBe("We don't charge setup fees, support is available 24/7.");
  });
});

describe('notifications are live', () => {
  it('starting a campaign and adding knowledge create notifications', async () => {
    const r = await register();
    const agentId = (await api(r.token).get('/api/agents')).body.agents[0]._id;
    const c = await api(r.token).post('/api/campaigns', { name: 'Dentists', category: 'Dentists', agentId, research: { enabled: true, keywords: ['dentist'], countries: ['USA'] } });
    await api(r.token).post(`/api/campaigns/${c.body._id}/start`);
    await api(r.token).post('/api/knowledge/text', { title: 'Pricing', content: 'Website rebuilds start at $900 and take about two weeks.' });
    await drain();
    const n = (await api(r.token).get('/api/notifications')).body;
    const titles = n.items.map((x: any) => x.title);
    expect(titles).toContain('Campaign started');
    expect(titles).toContain('Knowledge added');
    expect(n.unread).toBeGreaterThanOrEqual(2);
  });
});

describe('runs on a small server', () => {
  it('falls back to built-in embeddings when OpenAI has no credits', async () => {
    const broken = { model: 'openai', dims: 3, embed: async () => { throw new Error('OpenAI embeddings API error 429: insufficient_quota credit_balance_exhausted'); } };
    const e = new FallbackEmbeddings(broken as any);
    const v = await e.embed(['hello world']);
    expect(v[0].length).toBe(768);
    expect(e.model).toBe('local-hash-v1');
  });
});

describe('background job loop (slow remote databases)', () => {
  it('starts new work within a second, never overlaps, and goes quiet when idle', async () => {
    const { registerHandler, enqueue, startWorkers, stopWorkers } = await import('../../src/queue/queue.js');
    let running = 0, maxRunning = 0, done = 0;
    registerHandler('test.slow', async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 150)); running--; done++; }, 2);
    startWorkers();
    try {
      const t0 = Date.now();
      for (let i = 0; i < 6; i++) await enqueue('test.slow', { i });
      while (done < 6 && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
      expect(done).toBe(6);
      expect(maxRunning).toBeLessThanOrEqual(2); // per-type concurrency respected
      expect(Date.now() - t0).toBeLessThan(4000);
    } finally { stopWorkers(); }
  });
});
