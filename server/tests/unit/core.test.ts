import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, blindIndex } from '../../src/lib/crypto.js';
import { normalizeLead, domainOf, normalizeCompany } from '../../src/services/leads/normalize.js';
import { dedupeBatch } from '../../src/services/leads/dedupe.js';
import { scoreLead } from '../../src/services/leads/scoring.js';
import { chunkText } from '../../src/services/knowledge/chunk.js';
import { LocalHashEmbeddings, cosine } from '../../src/providers/embeddings/index.js';
import { extractiveAnswer } from '../../src/services/knowledge/retrieve.js';
import { parseCsv, toCsv } from '../../src/lib/csv.js';
import { stripOperators } from '../../src/lib/sanitize.js';
import { validateTwilioSignature } from '../../src/providers/telephony/twilio.js';
import { withinWindow } from '../../src/services/calls/compliance.js';
import { can } from '../../src/middleware/rbac.js';
import { ICP_SETTINGS } from '../helpers.js';
import crypto from 'node:crypto';

describe('field encryption', () => {
  it('round-trips and produces non-deterministic ciphertext', () => {
    const a = encrypt('+919876543210')!, b = encrypt('+919876543210')!;
    expect(a).not.toEqual(b);
    expect(a.startsWith('enc:v1:')).toBe(true);
    expect(decrypt(a)).toBe('+919876543210');
  });
  it('detects tampering', () => {
    const a = encrypt('secret')!;
    const tampered = a.slice(0, -4) + (a.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(decrypt(tampered)).toBeNull();
  });
  it('blind index is deterministic and case-insensitive', () => {
    expect(blindIndex('A@B.com')).toBe(blindIndex('a@b.com '));
    expect(blindIndex('x')).not.toBe(blindIndex('y'));
  });
});

describe('lead normalisation & de-duplication', () => {
  it('normalises phone, email, domain and company', () => {
    const n = normalizeLead({ companyName: '  Nova  Retail Pvt. Ltd. ', phone: '098765 43210', email: ' Raj@NovaRetail.in ', website: 'www.novaretail.in/about' });
    expect(n.phone).toBe('+919876543210');
    expect(n.email).toBe('raj@novaretail.in');
    expect(n.domain).toBe('novaretail.in');
    expect(normalizeCompany('Nova Retail Pvt. Ltd.')).toBe('nova retail');
    expect(domainOf('https://www.x.com/a')).toBe('x.com');
  });
  it('rejects invalid email/phone', () => {
    const n = normalizeLead({ companyName: 'X', phone: '123', email: 'nope' });
    expect(n.phone).toBeUndefined();
    expect(n.email).toBeUndefined();
  });
  it('removes in-batch duplicates by phone, email and company key', () => {
    const a = normalizeLead({ companyName: 'Nova Retail', phone: '+919876543210' });
    const b = normalizeLead({ companyName: 'Nova Retail Ltd', phone: '+91 98765 43210' });
    const c = normalizeLead({ companyName: 'Other', email: 'x@y.com' });
    const d = normalizeLead({ companyName: 'Different', email: 'X@y.com' });
    const r = dedupeBatch([a, b, c, d]);
    expect(r.leads).toHaveLength(2);
    expect(r.dupes).toBe(2);
  });
});

describe('lead qualification scoring', () => {
  const business = { ...ICP_SETTINGS, qualification: { hotThreshold: 70, warmThreshold: 40 } };
  it('scores an ideal-fit lead as hot with explainable breakdown', () => {
    const lead = normalizeLead({ companyName: 'Mumbai Care Clinic', contactName: 'Dr Rao', designation: 'Founder', industry: 'Healthcare', city: 'Mumbai', country: 'India', phone: '+919876543210', email: 'rao@care.in', website: 'care.in', companySize: '11-50', description: 'Clinic needing a CRM for customer follow-up' });
    const s = scoreLead(lead, business);
    expect(s.temperature).toBe('hot');
    expect(s.score).toBeGreaterThanOrEqual(80);
    expect(s.breakdown.reduce((a, b) => a + b.points, 0)).toBe(s.score);
    expect(s.breakdown.find((b) => b.factor === 'Industry')!.points).toBe(25);
  });
  it('scores a poor-fit lead as cold', () => {
    const s = scoreLead(normalizeLead({ companyName: 'Steel Mill', industry: 'Mining', city: 'Perth', country: 'Australia', designation: 'Intern' }), business);
    expect(s.temperature).toBe('cold');
    expect(s.score).toBeLessThan(40);
  });
});

describe('knowledge chunking and local retrieval', () => {
  it('chunks long text with bounded size', () => {
    const text = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} talks about topic ${i % 7}.`).join(' ');
    const chunks = chunkText(text, 400, 80);
    expect(chunks.length).toBeGreaterThan(3);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(480));
  });
  it('local embeddings rank the relevant chunk highest', async () => {
    const e = new LocalHashEmbeddings();
    const [q, a, b] = await e.embed(['what is the monthly price', 'Our pricing is ₹4,999 per month with a free trial', 'We are headquartered in Mumbai with 40 employees']);
    expect(cosine(q, a)).toBeGreaterThan(cosine(q, b));
  });
  it('extractive answer prefers matching FAQ answer', () => {
    const ans = extractiveAnswer('How much does it cost?', [{ id: '1', documentId: 'd', title: 'FAQ', score: 0.5, text: 'Q: How much does Acme CRM cost?\nA: It costs ₹4,999 per month.\n\nQ: Support?\nA: 24x7.' }]);
    expect(ans).toContain('4,999');
  });
});

describe('utilities', () => {
  it('parses quoted CSV and writes CSV', () => {
    const rows = parseCsv('Company,Phone,Notes\r\n"Acme, Inc",+919876543210,"said ""hi"""\n');
    expect(rows[0]).toEqual({ company: 'Acme, Inc', phone: '+919876543210', notes: 'said "hi"' });
    expect(toCsv([{ a: 'x,y' }], ['a'])).toBe('a\n"x,y"');
  });
  it('strips NoSQL operators from input', () => {
    expect(stripOperators({ email: { $gt: '' }, 'a.b': 1, ok: [{ $where: 1, v: 2 }] })).toEqual({ email: {}, ok: [{ v: 2 }] });
  });
  it('validates Twilio signatures', () => {
    const url = 'https://api.example.test/api/webhooks/twilio/status/abc';
    const params = { CallSid: 'CA1', CallStatus: 'completed' };
    const data = url + 'CallSidCA1CallStatuscompleted';
    const sig = crypto.createHmac('sha1', 'test_twilio_token').update(data).digest('base64');
    expect(validateTwilioSignature(url, params, sig)).toBe(true);
    expect(validateTwilioSignature(url, { ...params, CallStatus: 'busy' }, sig)).toBe(false);
  });
  it('evaluates calling windows in the target timezone', () => {
    const mon11IST = new Date('2026-11-09T05:30:00Z');
    expect(withinWindow(mon11IST, 'Asia/Kolkata', [1, 2, 3, 4, 5], '10:00', '18:00')).toBe(true);
    expect(withinWindow(mon11IST, 'Asia/Kolkata', [0, 6], '10:00', '18:00')).toBe(false);
    expect(withinWindow(mon11IST, 'America/New_York', [1, 2, 3, 4, 5], '10:00', '18:00')).toBe(false); // 00:30 NY
  });
  it('RBAC permission matrix', () => {
    expect(can('owner', 'team:manage')).toBe(true);
    expect(can('agent', 'leads:approve')).toBe(false);
    expect(can('agent', 'recordings:listen')).toBe(true);
    expect(can('agent', 'recordings:download')).toBe(false);
    expect(can('viewer', 'leads:write')).toBe(false);
  });
});
