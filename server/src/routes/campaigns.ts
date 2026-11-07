import { tp } from '../lib/tenant.js';
import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Campaign, CampaignLead, Lead, AIAgent, Call } from '../models/index.js';
import { scope } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { parse } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { dispatchCampaign } from '../services/campaigns/scheduler.js';
import { clock } from '../lib/clock.js';
import { Business } from '../models/index.js';
import { salesProfile, generateSalesProfile, problemMenu } from '../services/agent/playbook.js';
import { openingMessage } from '../services/agent/engine.js';
import { logger } from '../lib/logger.js';

/** The agent decides how to pitch each campaign. With an LLM it tailors it once per category; otherwise built-in. */
function tailorPitch(businessId: unknown, campaignId: unknown) {
  void (async () => {
    const [b, c] = await Promise.all([Business.findById(businessId).lean(), Campaign.findOne({ businessId, _id: campaignId })]);
    if (!b || !c) return;
    const sp = await generateSalesProfile(b, c.toObject());
    if (sp) { c.set('salesProfile', sp); await c.save(); }
  })().catch((e) => logger.warn({ err: e.message }, 'pitch tailoring failed'));
}

export const campaignsRouter = Router();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const oid = z.string().regex(/^[a-f0-9]{24}$/i);

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().max(60).optional(),
  description: z.string().trim().max(2000).optional(),
  agentId: oid,
  objective: z.string().trim().max(1000).optional(),
  script: z.string().trim().max(10000).optional(),
  autoCalling: z.boolean().optional(),
  schedule: z.object({ timezone: z.string().max(60), days: z.array(z.number().int().min(0).max(6)).min(1).max(7), startTime: time, endTime: time }).partial().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  retryDelayMinutes: z.number().int().min(5).max(10080).optional(),
  dailyLimit: z.number().int().min(1).max(10000).optional(),
  maxConcurrent: z.number().int().min(1).max(50).optional(),
  leadIds: z.array(oid).max(5000).optional(),
  endDate: z.coerce.date().nullable().optional(),
  research: z.object({
    enabled: z.boolean(), provider: z.string().max(40).optional(),
    keywords: z.array(z.string().trim().max(80)).max(20).optional(), industries: z.array(z.string().trim().max(80)).max(20).optional(),
    locations: z.array(z.string().trim().max(120)).max(30).optional(), countries: z.array(z.string().trim().max(60)).max(20).optional(),
    roles: z.array(z.string().trim().max(80)).max(20).optional(),
    frequency: z.enum(['daily', 'weekly', 'monthly']).optional(), leadsPerRun: z.number().int().min(1).max(200).optional(),
    autoApproveMinScore: z.number().min(0).max(100).optional(),
  }).optional(),
});

async function stats(businessId: Types.ObjectId, campaignIds: Types.ObjectId[]) {
  const outcomes = await CampaignLead.aggregate([
    { $match: { businessId, campaignId: { $in: campaignIds } } },
    { $lookup: { from: 'leads', localField: 'leadId', foreignField: '_id', as: 'l', pipeline: [{ $project: { outcome: 1 } }] } },
    { $group: { _id: { c: '$campaignId', o: { $ifNull: [{ $first: '$l.outcome' }, 'none'] } }, n: { $sum: 1 } } },
  ]);
  const [cl, calls] = await Promise.all([
    CampaignLead.aggregate([{ $match: { businessId, campaignId: { $in: campaignIds } } }, { $group: { _id: { c: '$campaignId', s: '$status' }, n: { $sum: 1 } } }]),
    Call.aggregate([{ $match: { businessId, campaignId: { $in: campaignIds } } }, { $group: { _id: { c: '$campaignId', r: '$result' }, n: { $sum: 1 }, d: { $sum: '$durationSec' } } }]),
  ]);
  const out: Record<string, any> = {};
  for (const id of campaignIds) out[String(id)] = { leads: {}, calls: { total: 0 }, totalDuration: 0, outcomes: {} };
  for (const r of outcomes) out[String(r._id.c)].outcomes[r._id.o] = r.n;
  for (const r of cl) { const o = out[String(r._id.c)]; o.leads[r._id.s] = r.n; o.leads.total = (o.leads.total ?? 0) + r.n; }
  for (const r of calls) { const o = out[String(r._id.c)]; o.calls[r._id.r ?? 'in_progress'] = r.n; o.calls.total += r.n; o.totalDuration += r.d; }
  return out;
}

campaignsRouter.get('/', async (req, res) => {
  const items = await Campaign.find(scope(req)).sort({ createdAt: -1 }).populate(tp('agentId', 'name')).lean();
  const s = await stats(req.tenant!.businessId, items.map((c) => c._id));
  res.json({ items: items.map((c) => ({ ...c, stats: s[String(c._id)] })) });
});

campaignsRouter.get('/:id', async (req, res) => {
  const c = await Campaign.findOne({ ...scope(req), _id: req.params.id }).populate(tp('agentId', 'name voice')).lean();
  if (!c) throw notFound('Campaign');
  const leads = await CampaignLead.find({ ...scope(req), campaignId: c._id }).sort({ updatedAt: -1 }).limit(500).populate(tp('leadId', 'companyName contactName phoneMasked temperature score status outcome outcomeNote followUpAt location')).lean();
  const b = await Business.findById(req.tenant!.businessId).lean();
  const prof = salesProfile({ business: b, campaign: c });
  const agent: any = c.agentId ?? {};
  const pitch = { ...prof, problemMenu: problemMenu(prof), opener: openingMessage({ business: b, agent: { name: agent.name ?? 'Sarah' }, campaign: c, lead: { contactName: 'Alex' } }), tailored: !!(c as any).salesProfile?.generatedAt };
  res.json({ ...c, stats: (await stats(req.tenant!.businessId, [c._id]))[String(c._id)], leads, pitch });
});

async function addLeads(req: any, campaignId: Types.ObjectId, ids: string[]) {
  const leads = await Lead.find({ ...scope(req), _id: { $in: ids }, approval: 'approved', doNotCall: false }, { _id: 1, phoneHash: 1 }).lean();
  const eligible = leads.filter((l) => l.phoneHash);
  if (!eligible.length) return { added: 0, skipped: ids.length };
  const ops = eligible.map((l) => ({ updateOne: { filter: { businessId: req.tenant.businessId, campaignId, leadId: l._id }, update: { $setOnInsert: { businessId: req.tenant.businessId, campaignId, leadId: l._id, status: 'queued', attempts: 0, nextAttemptAt: clock.now() } }, upsert: true } }));
  const r = await CampaignLead.bulkWrite(ops as any);
  return { added: r.upsertedCount, skipped: ids.length - r.upsertedCount };
}

campaignsRouter.post('/', requirePermission('campaigns:write'), async (req, res) => {
  const { leadIds, ...body } = parse(schema, req.body);
  if (!(await AIAgent.exists({ ...scope(req), _id: body.agentId }))) throw badRequest('Agent not found');
  const c = await Campaign.create({ ...body, ...scope(req), createdBy: req.auth!.userId });
  const r = leadIds?.length ? await addLeads(req, c._id, leadIds) : { added: 0, skipped: 0 };
  await audit(req, 'campaign.created', 'Campaign', c._id, r);
  tailorPitch(req.tenant!.businessId, c._id);
  res.status(201).json({ ...c.toJSON(), ...r });
});

campaignsRouter.patch('/:id', requirePermission('campaigns:write'), async (req, res) => {
  const { leadIds, ...body } = parse(schema.partial(), req.body);
  const c = await Campaign.findOne({ ...scope(req), _id: req.params.id });
  if (!c) throw notFound('Campaign');
  if (c.status === 'completed') throw badRequest('Completed campaigns cannot be edited');
  const { schedule, research, ...rest } = body;
  const recategorised = rest.category !== undefined && rest.category !== c.category;
  c.set(rest);
  if (recategorised) c.set('salesProfile', undefined);
  if (research) c.set('research', { ...c.toObject().research, ...research, ...(research.frequency !== c.research?.frequency ? { nextRunAt: undefined } : {}) });
  if (schedule) c.set('schedule', { ...c.toObject().schedule, ...schedule });
  await c.save();
  if (recategorised) tailorPitch(req.tenant!.businessId, c._id);
  res.json(c);
});

campaignsRouter.post('/:id/leads', requirePermission('campaigns:write'), async (req, res) => {
  const { leadIds } = parse(z.object({ leadIds: z.array(oid).min(1).max(5000) }), req.body);
  const c = await Campaign.findOne({ ...scope(req), _id: req.params.id });
  if (!c) throw notFound('Campaign');
  if (c.status === 'completed') c.status = 'paused';
  await c.save();
  res.json(await addLeads(req, c._id, leadIds));
});

campaignsRouter.delete('/:id/leads/:leadId', requirePermission('campaigns:write'), async (req, res) => {
  await CampaignLead.updateOne({ ...scope(req), campaignId: req.params.id, leadId: req.params.leadId, status: { $in: ['queued', 'retry'] } }, { status: 'skipped', skipReason: 'Removed manually' });
  res.status(204).end();
});

const transitions: Record<string, { from: string[]; to: string }> = {
  start: { from: ['draft', 'paused'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  resume: { from: ['paused'], to: 'active' },
  complete: { from: ['draft', 'active', 'paused'], to: 'completed' },
};

campaignsRouter.post('/:id/:action', requirePermission('campaigns:write'), async (req, res) => {
  const action = String(req.params.action);
  const t = transitions[action];
  if (!t) throw notFound('Action');
  const c = await Campaign.findOne({ ...scope(req), _id: req.params.id });
  if (!c) throw notFound('Campaign');
  if (!t.from.includes(c.status)) throw badRequest(`Cannot ${action} a ${c.status} campaign`);
  if (t.to === 'active' && !c.research?.enabled && !(await CampaignLead.exists({ ...scope(req), campaignId: c._id, status: { $in: ['queued', 'retry'] } }))) throw badRequest('Add approved leads, or turn on automatic research, before starting');
  if (t.to === 'active' && c.endDate && c.endDate < clock.now()) throw badRequest('The end date has passed — extend it to restart this campaign');
  c.status = t.to as any;
  if (action === 'start') c.startedAt = new Date();
  if (action === 'complete') {
    c.completedAt = new Date();
    await CampaignLead.updateMany({ ...scope(req), campaignId: c._id, status: { $in: ['queued', 'retry'] } }, { status: 'skipped', skipReason: 'Campaign completed' });
  }
  await c.save();
  await audit(req, `campaign.${action}`, 'Campaign', c._id);
  if (c.status === 'active' && c.research?.enabled && (action === 'start' || action === 'resume')) {
    const { runCampaignResearch } = await import('../services/campaigns/scheduler.js');
    await runCampaignResearch();
  }
  if (c.status === 'active' && c.autoCalling) await dispatchCampaign(c.toObject());
  res.json(c);
});

campaignsRouter.delete('/:id', requirePermission('campaigns:write'), async (req, res) => {
  const c = await Campaign.findOne({ ...scope(req), _id: req.params.id });
  if (!c) throw notFound('Campaign');
  if (c.status === 'active') throw badRequest('Pause the campaign before deleting it');
  await CampaignLead.deleteMany({ ...scope(req), campaignId: c._id });
  await Campaign.deleteOne({ ...scope(req), _id: c._id });
  await audit(req, 'campaign.deleted', 'Campaign', c._id);
  res.status(204).end();
});
