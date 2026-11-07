import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { useDb, register, api } from '../helpers.js';
import { drain } from '../../src/queue/queue.js';
import { ICP_SETTINGS } from '../helpers.js';

useDb();

/** Minimal valid single-page PDF containing the given text. */
function makePdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

let server: http.Server; let port = 0;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') { res.end('User-agent: *\nDisallow: /private'); return; }
    res.setHeader('content-type', 'text/html');
    if (req.url === '/') return res.end('<html><head><title>Acme Home</title></head><body><h1>Acme CRM</h1><p>We automate customer follow-ups for retail stores.</p><a href="/pricing">Pricing</a><a href="/private/x">Secret</a></body></html>');
    if (req.url === '/pricing') return res.end('<html><title>Pricing</title><body><h2>Plans</h2><p>The Growth plan includes unlimited WhatsApp follow-ups and costs 7999 rupees per month.</p></body></html>');
    if (req.url?.startsWith('/private')) return res.end('<html><body><p>Internal confidential roadmap codename PHOENIX.</p></body></html>');
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => server.listen(0, () => { port = (server.address() as any).port; r(); }));
});
afterAll(() => server.close());

describe('knowledge base & RAG', () => {
  it('indexes business settings (profile, products, FAQs) automatically', async () => {
    const r = await register();
    await api(r.token).patch('/api/business', ICP_SETTINGS);
    const kb = await api(r.token).get('/api/knowledge');
    const types = kb.body.documents.map((d: any) => d.type);
    expect(types).toEqual(expect.arrayContaining(['profile', 'faq']));
    expect(kb.body.documents.every((d: any) => d.status === 'ready')).toBe(true);
    const qa = await api(r.token).post('/api/knowledge/query', { question: 'Do you offer support in Hindi?' });
    expect(qa.body.answer).toMatch(/24x7/);
    expect(qa.body.sources.length).toBeGreaterThan(0);
  });
  it('uploads TXT and PDF documents, processes them in the background, and retrieves them', async () => {
    const r = await register();
    const up = await api(r.token).post('/api/knowledge/upload').attach('files', Buffer.from('Refund policy: customers can cancel anytime and receive a prorated refund within 7 business days.'), 'policy.txt').attach('files', makePdf('Warranty: all hardware ships with a 3 year onsite warranty.'), 'warranty.pdf');
    expect(up.status).toBe(202);
    expect(up.body.documents.every((d: any) => d.status === 'pending')).toBe(true);
    await drain();
    const kb = await api(r.token).get('/api/knowledge');
    const docs = kb.body.documents.filter((d: any) => !d.system);
    expect(docs.map((d: any) => d.status)).toEqual(['ready', 'ready']);
    expect((await api(r.token).post('/api/knowledge/query', { question: 'What is the refund policy?' })).body.answer).toMatch(/prorated refund/);
    expect((await api(r.token).post('/api/knowledge/query', { question: 'How long is the warranty?' })).body.answer).toMatch(/3 year/);
  });
  it('rejects unsupported and corrupt files', async () => {
    const r = await register();
    expect((await api(r.token).post('/api/knowledge/upload').attach('files', Buffer.from('MZ...'), 'virus.exe')).status).toBe(400);
    await api(r.token).post('/api/knowledge/upload').attach('files', Buffer.from('not a pdf'), 'fake.pdf');
    await drain();
    const doc = (await api(r.token).get('/api/knowledge')).body.documents.find((d: any) => d.title === 'fake');
    expect(doc.status).toBe('failed');
    expect(doc.error).toMatch(/PDF/);
  });
  it('imports a website (same-origin crawl, honours robots.txt)', async () => {
    const r = await register();
    const res = await api(r.token).post('/api/knowledge/website', { url: `http://127.0.0.1:${port}/`, maxPages: 5 });
    expect(res.status).toBe(202);
    await drain();
    const doc = (await api(r.token).get(`/api/knowledge/${res.body._id}`)).body;
    expect(doc.status).toBe('ready');
    expect(doc.rawText).toContain('7999 rupees');
    expect(doc.rawText).not.toContain('PHOENIX');
    expect((await api(r.token).post('/api/knowledge/query', { question: 'How much is the Growth plan?' })).body.answer).toMatch(/7999/);
  });
  it('supports manual text, update (reindex) and deletion', async () => {
    const r = await register();
    const t = await api(r.token).post('/api/knowledge/text', { title: 'Delivery', content: 'We deliver across Maharashtra within 48 hours of order confirmation.' });
    await drain();
    expect((await api(r.token).post('/api/knowledge/search', { query: 'delivery time Maharashtra' })).body.results[0].text).toMatch(/48 hours/);
    expect((await api(r.token).delete(`/api/knowledge/${t.body._id}`)).status).toBe(204);
    expect((await api(r.token).post('/api/knowledge/search', { query: 'delivery time Maharashtra' })).body.results.find((x: any) => /48 hours/.test(x.text))).toBeUndefined();
  });
  it('viewers cannot modify the knowledge base', async () => {
    const owner = await register();
    const inv = await api(owner.token).post('/api/team/invite', { email: `kv_${Date.now()}@x.test`, role: 'viewer' });
    const { default: request } = await import('supertest');
    const { app } = await import('../helpers.js');
    const acc = await request(app).post('/api/auth/accept-invite').send({ token: new URL(inv.body.inviteLink).searchParams.get('token'), name: 'Vi', password: 'Passw0rd!' });
    expect((await api(acc.body.token).post('/api/knowledge/text', { title: 'x', content: 'x'.repeat(30) })).status).toBe(403);
    expect((await api(acc.body.token).post('/api/knowledge/query', { question: 'anything?' })).status).toBe(200);
  });
});
