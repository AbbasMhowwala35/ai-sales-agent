import { Router } from 'express';
import { z } from 'zod';
import { Business } from '../models/index.js';
import { parse } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';
import { requirePermission } from '../middleware/rbac.js';
import { audit } from '../services/audit.js';
import { syncBusinessProfileKnowledge } from '../services/knowledge/ingest.js';
import { toE164 } from '../lib/phone.js';

export const businessRouter = Router();

const s = (max = 2000) => z.string().trim().max(max).optional();
const item = z.object({ name: z.string().trim().min(1).max(200), description: s(2000), price: s(100) });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');

export const businessUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  industry: s(120), website: s(300), location: s(200), description: s(5000), phone: s(30),
  products: z.array(item).max(100).optional(),
  services: z.array(item).max(100).optional(),
  targetAudience: s(3000),
  icp: z.object({
    industries: z.array(z.string().trim().max(80)).max(50).optional(),
    companySizes: z.array(z.string().trim().max(40)).max(20).optional(),
    roles: z.array(z.string().trim().max(80)).max(50).optional(),
    keywords: z.array(z.string().trim().max(80)).max(100).optional(),
    budgetMin: z.number().min(0).optional(),
    budgetMax: z.number().min(0).optional(),
    currency: s(5),
    requirements: s(3000),
  }).partial().optional(),
  targetLocations: z.array(z.string().trim().max(120)).max(50).optional(),
  faqs: z.array(z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().min(1).max(3000) })).max(200).optional(),
  salesScripts: z.array(z.object({ name: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(10000) })).max(50).optional(),
  goals: s(3000),
  qualification: z.object({
    hotThreshold: z.number().min(1).max(100), warmThreshold: z.number().min(0).max(99),
    requirePhone: z.boolean(), autoApproveAbove: z.number().min(0).max(100), criteria: s(3000),
  }).partial().optional(),
  compliance: z.object({
    timezone: s(60), callingWindowStart: time, callingWindowEnd: time,
    callingDays: z.array(z.number().int().min(0).max(6)).max(7),
    recordCalls: z.boolean(), recordingConsentMessage: s(500), requireConsentForRecording: z.boolean(),
    maxAttemptsPerLead: z.number().int().min(1).max(10), honorRegistryDnc: z.boolean(),
  }).partial().optional(),
  transferNumber: s(30),
  callerIds: z.array(z.object({
    country: z.string().trim().length(2).transform((x) => x.toUpperCase()),
    number: z.string().trim().max(30).refine((n) => !!toE164(n), 'Caller ID must be a valid number with country code, e.g. +1 415 555 0100'),
    vapiPhoneNumberId: s(80), label: s(60),
  })).max(30).optional(),
  targetCountries: z.array(z.string().trim().max(60)).max(30).optional(),
  priorityRules: z.array(z.object({
    priority: z.number().int().min(1).max(3), label: s(120),
    signal: z.enum(['no_website', 'weak_website', 'good_website', 'no_online_booking', 'has_online_booking', 'not_mobile_friendly', 'no_https', 'outdated_website', 'keyword_present', 'keyword_absent', 'any']),
    value: s(80),
  })).max(12).optional(),
  followUps: z.object({ autoCallBack: z.boolean(), autoNurture: z.boolean(), nurtureDefaultDays: z.number().int().min(7).max(365), dailyLimit: z.number().int().min(1).max(5000) }).partial().optional(),
  onboardingComplete: z.boolean().optional(),
});

businessRouter.get('/', async (req, res) => {
  const b = await Business.findById(req.tenant!.businessId).lean();
  if (!b) throw notFound('Business');
  res.json(b);
});

businessRouter.get('/priority-templates', async (_req, res) => {
  const { PRIORITY_TEMPLATES } = await import('../services/leads/priority.js');
  res.json(PRIORITY_TEMPLATES);
});

businessRouter.patch('/', requirePermission('business:write'), async (req, res) => {
  const body = parse(businessUpdateSchema, req.body);
  const b = await Business.findById(req.tenant!.businessId);
  if (!b) throw notFound('Business');
  const { icp, qualification, compliance, followUps, ...rest } = body;
  if (rest.callerIds) rest.callerIds = rest.callerIds.map((c) => ({ ...c, number: toE164(c.number)! }));
  if (followUps) b.set('followUps', { ...(b.toObject().followUps ?? {}), ...followUps });
  b.set(rest);
  if (icp) b.set('icp', { ...(b.toObject().icp ?? {}), ...icp });
  if (qualification) b.set('qualification', { ...(b.toObject().qualification ?? {}), ...qualification });
  if (compliance) b.set('compliance', { ...(b.toObject().compliance ?? {}), ...compliance });
  await b.save();
  await syncBusinessProfileKnowledge(b);
  if (body.priorityRules) {
    const { enqueue } = await import('../queue/queue.js');
    await enqueue('leads.prioritize', { all: true }, { businessId: b._id, uniqueKey: `prio:${b._id}` });
  }
  await audit(req, 'business.updated', 'Business', b._id, { fields: Object.keys(body) });
  res.json(b.toJSON());
});
