import { tp } from '../lib/tenant.js';
import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Lead, Activity, Reminder, Call, Appointment, Business, TeamMember, LEAD_STATUSES, DncEntry } from '../models/index.js';
import { scope } from '../middleware/auth.js';
import { requirePermission, can } from '../middleware/rbac.js';
import { parse, pageParams } from '../lib/validate.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { escapeRegex } from '../lib/sanitize.js';
import { logActivity } from '../services/activity.js';
import { audit } from '../services/audit.js';
import { scoreLead } from '../services/leads/scoring.js';
import { normalizeLead } from '../services/leads/normalize.js';
import { findDuplicate } from '../services/leads/dedupe.js';
import { toCsv } from '../lib/csv.js';
import { blindIndex } from '../lib/crypto.js';
import { notify } from '../services/notifications.js';
import { leadTimezone } from '../services/calls/compliance.js';

export const leadsRouter = Router();
const id = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

function buildFilter(req: any) {
  const q = req.query as Record<string, string>;
  const f: any = { ...scope(req) };
  if (q.status) f.status = { $in: q.status.split(',').filter((s) => (LEAD_STATUSES as readonly string[]).includes(s)) };
  if (q.temperature) f.temperature = { $in: q.temperature.split(',') };
  if (q.approval) f.approval = q.approval;
  if (q.outcome) f.outcome = { $in: q.outcome.split(',') };
  if (q.category) f.category = q.category === '__none' ? { $in: [null, undefined, ''] } : q.category;
  if (q.priority) f.priority = q.priority === 'none' ? { $in: [null, undefined] } : { $in: q.priority.split(',').map(Number).filter(Boolean) };
  if (q.followUpDue === 'true') f.followUpAt = { $lte: new Date() };
  if (q.upcoming === 'true') f.followUpAt = { $gte: new Date(Date.now() - 3600_000) };
  if (q.campaignId && /^[a-f0-9]{24}$/i.test(q.campaignId)) f.campaignId = q.campaignId;
  if (q.source) f.source = q.source;
  if (q.assignedTo === 'me') f.assignedTo = req.auth.userId;
  else if (q.assignedTo === 'unassigned') f.assignedTo = { $in: [null, undefined] };
  else if (q.assignedTo && /^[a-f0-9]{24}$/i.test(q.assignedTo)) f.assignedTo = q.assignedTo;
  if (q.minScore) f.score = { $gte: Number(q.minScore) || 0 };
  if (q.runId && /^[a-f0-9]{24}$/i.test(q.runId)) f.discoveryRunId = q.runId;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search.slice(0, 100)), 'i');
    f.$or = [{ companyName: rx }, { contactName: rx }, { domain: rx }, { industry: rx }, { 'location.city': rx }];
    const ph = blindIndex(q.search.replace(/[^\d+]/g, '').length > 6 ? q.search : '');
    const em = q.search.includes('@') ? blindIndex(q.search) : undefined;
    if (ph) f.$or.push({ phoneHash: ph });
    if (em) f.$or.push({ emailHash: em });
  }
  return f;
}

leadsRouter.get('/', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query as any);
  const f = buildFilter(req);
  const sortField = String(req.query.sort ?? '-createdAt');
  const allowed = ['createdAt', 'score', 'companyName', 'lastContactedAt', 'updatedAt', 'followUpAt', 'outcomeAt', 'priority'];
  const key = sortField.replace(/^-/, '');
  const sort: any = key === 'priority' ? { priority: 1, score: -1 } : allowed.includes(key) ? { [key]: sortField.startsWith('-') ? -1 : 1 } : { createdAt: -1 };
  // “available” = can be put in a new campaign: approved, callable, not closed, not queued in another running campaign
  if (req.query.available === 'true') {
    const { CampaignLead } = await import('../models/index.js');
    const busy = await CampaignLead.distinct('leadId', { ...scope(req), status: { $in: ['queued', 'retry', 'calling'] } });
    f._id = { $nin: busy };
    f.doNotCall = false;
    f.outcome = { $nin: ['not_interested', 'do_not_call', 'meeting'] };
  }
  const [items, total] = await Promise.all([
    Lead.find(f).sort(sort).skip(skip).limit(limit).populate('assignedTo', 'name email'),
    Lead.countDocuments(f),
  ]);
  const tz = (await Business.findById(req.tenant!.businessId, { compliance: 1 }).lean())?.compliance?.timezone ?? 'UTC';
  res.json({ items: items.map((l) => ({ ...l.toJSON(), localTz: leadTimezone(l, tz) })), total, page, limit });
});

/**
 * Existing leads that can be added to a new campaign, with the campaigns that already contacted each one.
 * Excludes Do-Not-Call and leads currently queued in another running campaign; the client groups by
 * category → result → campaign.
 */
leadsRouter.get('/picker', async (req, res) => {
  const { CampaignLead } = await import('../models/index.js');
  const q = req.query as Record<string, string>;
  const f: any = { ...scope(req), approval: 'approved', doNotCall: false, outcome: { $ne: 'do_not_call' }, phoneHash: { $exists: true, $ne: null } };
  if (q.category) f.category = q.category === '__none' ? { $in: [null, undefined, ''] } : q.category;
  if (q.search) { const rx = new RegExp(escapeRegex(q.search.slice(0, 100)), 'i'); f.$or = [{ companyName: rx }, { contactName: rx }, { 'location.city': rx }, { 'location.state': rx }]; }
  const busy = await CampaignLead.distinct('leadId', { ...scope(req), status: { $in: ['queued', 'retry', 'calling'] } });
  f._id = { $nin: busy };
  const leads = await Lead.find(f).sort({ priority: 1, score: -1 }).limit(1500);
  const links = await CampaignLead.find({ ...scope(req), leadId: { $in: leads.map((l) => l._id) } }, { leadId: 1, campaignId: 1, status: 1, outcome: 1, updatedAt: 1 })
    .populate(tp('campaignId', 'name status category')).lean();
  const byLead = new Map<string, any[]>();
  for (const k of links as any[]) {
    if (!k.campaignId) continue;
    const arr = byLead.get(String(k.leadId)) ?? [];
    arr.push({ _id: k.campaignId._id, name: k.campaignId.name, status: k.campaignId.status, leadStatus: k.status, at: k.updatedAt });
    byLead.set(String(k.leadId), arr);
  }
  const items = leads.map((l) => {
    const j: any = l.toJSON();
    const campaigns = (byLead.get(String(l._id)) ?? []).sort((a, b) => +new Date(b.at) - +new Date(a.at));
    return { _id: j._id, companyName: j.companyName, contactName: j.contactName, phoneMasked: j.phoneMasked, category: j.category || null,
      priority: j.priority, priorityReason: j.priorityReason, outcome: j.outcome ?? 'none', outcomeNote: j.outcomeNote, followUpAt: j.followUpAt,
      score: j.score, temperature: j.temperature, city: j.location?.city, state: j.location?.state, country: j.location?.country,
      lastContactedAt: j.lastContactedAt, contacted: !!j.lastContactedAt || campaigns.some((c) => c.leadStatus !== 'queued'), campaigns };
  });
  res.json({ items, hiddenInRunning: busy.length });
});

leadsRouter.get('/pipeline', async (req, res) => {
  const rows = await Lead.aggregate([{ $match: { businessId: req.tenant!.businessId, approval: { $ne: 'rejected' } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, rows.find((r) => r._id === s)?.count ?? 0]));
  res.json({ stages: LEAD_STATUSES, counts });
});

leadsRouter.get('/categories', async (req, res) => {
  const rows = await Lead.aggregate([{ $match: { businessId: req.tenant!.businessId } }, { $group: { _id: { c: '$category', p: '$priority' }, n: { $sum: 1 } } }]);
  const map = new Map<string, any>();
  for (const r of rows) {
    const k = r._id.c || '';
    const e = map.get(k) ?? { name: k || 'Uncategorised', key: k || '__none', total: 0, p1: 0, p2: 0, p3: 0 };
    e.total += r.n; if (r._id.p) e[`p${r._id.p}`] += r.n;
    map.set(k, e);
  }
  res.json({ categories: [...map.values()].sort((a, b) => b.total - a.total) });
});

leadsRouter.get('/outcomes', async (req, res) => {
  const rows = await Lead.aggregate([{ $match: { businessId: req.tenant!.businessId } }, { $group: { _id: '$outcome', n: { $sum: 1 }, due: { $sum: { $cond: [{ $and: [{ $ne: ['$followUpAt', null] }, { $lte: ['$followUpAt', new Date()] }] }, 1, 0] } } } }]);
  res.json({ counts: Object.fromEntries(rows.map((r) => [r._id ?? 'none', r.n])), due: rows.reduce((a, r) => a + (['callback', 'nurture', 'interested'].includes(r._id) ? r.due : 0), 0) });
});

leadsRouter.get('/export', requirePermission('leads:approve'), async (req, res) => {
  const items = await Lead.find(buildFilter(req)).limit(10_000);
  const rows = items.map((l) => { const j: any = l.toJSON(); return { ...j, city: j.location?.city, country: j.location?.country }; });
  await audit(req, 'leads.exported', 'Lead', undefined, { count: rows.length });
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', 'attachment; filename="leads.csv"');
  res.send(toCsv(rows, ['companyName', 'contactName', 'designation', 'email', 'phone', 'website', 'city', 'country', 'industry', 'source', 'score', 'temperature', 'status', 'approval']));
});

const createSchema = z.object({
  companyName: z.string().trim().min(1).max(200), contactName: z.string().trim().max(120).optional(),
  designation: z.string().trim().max(120).optional(), email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(), website: z.string().trim().max(300).optional(),
  city: z.string().trim().max(100).optional(), country: z.string().trim().max(100).optional(), category: z.string().trim().max(60).optional(),
  industry: z.string().trim().max(120).optional(), companySize: z.string().trim().max(40).optional(),
  description: z.string().trim().max(2000).optional(), consent: z.enum(['unknown', 'granted']).optional(),
});

leadsRouter.post('/', requirePermission('leads:write'), async (req, res) => {
  const body = parse(createSchema, req.body);
  const n = normalizeLead(body as any);
  if (body.phone && !n.phone) throw badRequest('Phone number is not valid. Include the country code, e.g. +91 98765 43210');
  const dup = await findDuplicate(req.tenant!.businessId, n);
  if (dup) throw badRequest(`This lead already exists (${dup.companyName})`, { duplicateId: dup._id });
  const b = await Business.findById(req.tenant!.businessId).lean();
  const s = scoreLead(n, b);
  const dnc = n.phone ? await DncEntry.exists({ ...scope(req), phoneHash: blindIndex(n.phone) }) : null;
  const lead = await Lead.create({ ...n, ...scope(req), category: body.category, source: 'manual', score: s.score, temperature: s.temperature, scoreBreakdown: s.breakdown, status: s.temperature !== 'cold' ? 'qualified' : 'new', consent: body.consent ?? 'unknown', doNotCall: !!dnc });
  await logActivity(req.tenant!.businessId, lead._id, 'created', `Lead added manually by ${req.auth!.name}`, {}, req.auth!.userId);
  res.status(201).json(lead.toJSON());
});

leadsRouter.get('/:id', async (req, res) => {
  parse(id, req.params.id);
  const lead = await Lead.findOne({ ...scope(req), _id: req.params.id }).populate('assignedTo', 'name email');
  if (!lead) throw notFound('Lead');
  const [activities, reminders, calls, appointments] = await Promise.all([
    Activity.find({ ...scope(req), leadId: lead._id }).sort({ createdAt: -1 }).limit(200).populate('userId', 'name').lean(),
    Reminder.find({ ...scope(req), leadId: lead._id }).sort({ dueAt: 1 }).populate('userId', 'name').lean(),
    Call.find({ ...scope(req), leadId: lead._id }).sort({ createdAt: -1 }).limit(50).populate(tp('campaignId', 'name')),
    Appointment.find({ ...scope(req), leadId: lead._id }).sort({ startsAt: -1 }).lean(),
  ]);
  const tz = (await Business.findById(req.tenant!.businessId, { compliance: 1 }).lean())?.compliance?.timezone ?? 'UTC';
  res.json({ lead: { ...lead.toJSON(), localTz: leadTimezone(lead, tz) }, activities, reminders, calls: calls.map((c) => c.toJSON()), appointments });
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(LEAD_STATUSES).optional(),
  assignedTo: z.string().regex(/^[a-f0-9]{24}$/i).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
  consent: z.enum(['unknown', 'granted', 'revoked']).optional(),
  outcome: z.enum(['none', 'meeting', 'interested', 'callback', 'nurture', 'busy', 'no_answer', 'not_interested', 'do_not_call']).optional(),
  outcomeNote: z.string().trim().max(500).optional(),
  followUpAt: z.coerce.date().nullable().optional(),
});

leadsRouter.patch('/:id', requirePermission('leads:write'), async (req, res) => {
  const body = parse(updateSchema, req.body);
  const lead = await Lead.findOne({ ...scope(req), _id: req.params.id });
  if (!lead) throw notFound('Lead');
  const prevStatus = lead.status;
  const { city, country, assignedTo, phone, email, ...rest } = body;
  if (phone !== undefined) {
    const n = normalizeLead({ companyName: lead.companyName, phone });
    if (phone && !n.phone) throw badRequest('Phone number is not valid');
    lead.set('phone', n.phone);
  }
  if (email !== undefined) lead.set('email', email || undefined);
  lead.set(rest);
  if (city !== undefined) lead.set('location.city', city);
  if (country !== undefined) lead.set('location.country', country);
  if (assignedTo !== undefined) {
    if (assignedTo && !(await TeamMember.exists({ ...scope(req), userId: assignedTo, status: 'active' }))) throw badRequest('Assignee is not an active team member');
    lead.set('assignedTo', assignedTo ?? undefined);
  }
  if (body.consent === 'revoked' || body.outcome === 'do_not_call') { lead.doNotCall = true; lead.consent = 'revoked'; }
  if (body.outcome) { lead.outcomeAt = new Date(); if (body.outcome === 'not_interested') lead.status = 'lost'; }
  if (body.followUpAt !== undefined) { lead.set('followUpQueuedAt', null); lead.set('nextFollowUpAt', body.followUpAt); }
  await lead.save();
  if (body.status && body.status !== prevStatus) await logActivity(req.tenant!.businessId, lead._id, 'status_change', `Status changed from ${prevStatus} to ${body.status}`, { from: prevStatus, to: body.status }, req.auth!.userId);
  if (assignedTo !== undefined) {
    await logActivity(req.tenant!.businessId, lead._id, 'assignment', assignedTo ? 'Lead assigned' : 'Lead unassigned', { assignedTo }, req.auth!.userId);
    if (assignedTo && assignedTo !== req.auth!.userId) await notify(req.tenant!.businessId, { userId: assignedTo, title: 'Lead assigned to you', message: lead.companyName, link: `/leads/${lead._id}` });
  }
  res.json((await lead.populate('assignedTo', 'name email')).toJSON());
});

leadsRouter.post('/bulk', requirePermission('leads:write'), async (req, res) => {
  const body = parse(z.object({
    ids: z.array(id).min(1).max(1000),
    action: z.enum(['approve', 'reject', 'status', 'assign', 'delete', 'rescore', 'category', 'reprioritize']),
    status: z.enum(LEAD_STATUSES).optional(), assignedTo: id.nullable().optional(), category: z.string().trim().max(60).optional(),
  }), req.body);
  const role = req.auth!.role;
  if (['approve', 'reject'].includes(body.action) && !can(role, 'leads:approve')) throw forbidden();
  if (body.action === 'delete' && !can(role, 'leads:delete')) throw forbidden();
  const f = { ...scope(req), _id: { $in: body.ids.map((x) => new Types.ObjectId(x)) } };
  let modified = 0;
  if (body.action === 'approve' || body.action === 'reject') {
    const approval = body.action === 'approve' ? 'approved' : 'rejected';
    const r = await Lead.updateMany({ ...f, approval: { $ne: approval } }, { approval, ...(approval === 'rejected' ? { status: 'lost' } : {}) });
    modified = r.modifiedCount;
    await Activity.insertMany(body.ids.map((leadId) => ({ businessId: req.tenant!.businessId, leadId, type: 'approval', message: `Lead ${approval} for outreach by ${req.auth!.name}`, userId: req.auth!.userId })));
  } else if (body.action === 'status') {
    if (!body.status) throw badRequest('status is required');
    modified = (await Lead.updateMany(f, { status: body.status })).modifiedCount;
  } else if (body.action === 'assign') {
    if (body.assignedTo && !(await TeamMember.exists({ ...scope(req), userId: body.assignedTo, status: 'active' }))) throw badRequest('Assignee is not an active team member');
    modified = (await Lead.updateMany(f, body.assignedTo ? { assignedTo: body.assignedTo } : { $unset: { assignedTo: 1 } })).modifiedCount;
  } else if (body.action === 'delete') {
    modified = (await Lead.deleteMany(f)).deletedCount;
  } else if (body.action === 'category') {
    modified = (await Lead.updateMany(f, { category: body.category || undefined })).modifiedCount;
  } else if (body.action === 'reprioritize') {
    const { prioritizeLeads } = await import('../services/leads/priority.js');
    await Lead.updateMany(f, { $unset: { websiteAudit: 1 } });
    modified = await prioritizeLeads(await Business.findById(req.tenant!.businessId).lean(), body.ids);
  } else if (body.action === 'rescore') {
    const b = await Business.findById(req.tenant!.businessId).lean();
    for (const lead of await Lead.find(f)) {
      const s = scoreLead(lead.toJSON() as any, b);
      lead.set({ score: s.score, temperature: s.temperature, scoreBreakdown: s.breakdown });
      await lead.save(); modified++;
    }
  }
  await audit(req, `leads.bulk_${body.action}`, 'Lead', undefined, { count: body.ids.length });
  res.json({ modified });
});

leadsRouter.post('/:id/notes', requirePermission('leads:write'), async (req, res) => {
  const { text } = parse(z.object({ text: z.string().trim().min(1).max(5000) }), req.body);
  const lead = await Lead.findOne({ ...scope(req), _id: req.params.id }, { _id: 1 }).lean();
  if (!lead) throw notFound('Lead');
  const a = await logActivity(req.tenant!.businessId, lead._id, 'note', text, {}, req.auth!.userId);
  res.status(201).json(a);
});

leadsRouter.post('/:id/reminders', requirePermission('leads:write'), async (req, res) => {
  const body = parse(z.object({ dueAt: z.coerce.date(), note: z.string().trim().max(1000).optional() }), req.body);
  if (body.dueAt.getTime() < Date.now() - 60_000) throw badRequest('Reminder time must be in the future');
  const lead = await Lead.findOne({ ...scope(req), _id: req.params.id });
  if (!lead) throw notFound('Lead');
  const r = await Reminder.create({ ...scope(req), leadId: lead._id, userId: req.auth!.userId, dueAt: body.dueAt, note: body.note });
  lead.nextFollowUpAt = body.dueAt; await lead.save();
  await logActivity(req.tenant!.businessId, lead._id, 'reminder', `Follow-up scheduled for ${body.dueAt.toISOString()}`, { reminderId: r._id }, req.auth!.userId);
  res.status(201).json(r);
});

leadsRouter.patch('/:id/reminders/:rid', requirePermission('leads:write'), async (req, res) => {
  const { done } = parse(z.object({ done: z.boolean() }), req.body);
  const r = await Reminder.findOneAndUpdate({ ...scope(req), _id: req.params.rid, leadId: req.params.id }, { done }, { returnDocument: 'after' });
  if (!r) throw notFound('Reminder');
  res.json(r);
});

leadsRouter.get('/reminders/upcoming', async (req, res) => {
  res.json({ reminders: await Reminder.find({ ...scope(req), userId: req.auth!.userId, done: false }).sort({ dueAt: 1 }).limit(20).populate(tp('leadId', 'companyName contactName')).lean() });
});
