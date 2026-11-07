import { Router } from 'express';
import { z } from 'zod';
import { Notification, DncEntry, AuditLog, Lead, Business } from '../models/index.js';
import { scope } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { parse, pageParams } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { toE164, maskPhone } from '../lib/phone.js';
import { blindIndex } from '../lib/crypto.js';
import { analytics } from '../services/analytics.js';
import { audit } from '../services/audit.js';
import { addToDnc } from '../services/calls/lifecycle.js';
import { env } from '../config/env.js';
import { getLLM } from '../providers/llm/index.js';
import { getEmbeddings } from '../providers/embeddings/index.js';
import { listLeadProviders } from '../providers/leads/index.js';
import { parseCsv } from '../lib/csv.js';

/* ------------------------------ Analytics ----------------------------- */
export const analyticsRouter = Router();
analyticsRouter.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 29 * 86400_000);
  if (isNaN(+from) || isNaN(+to) || from > to) throw badRequest('Invalid date range');
  if (to.getTime() - from.getTime() > 366 * 86400_000) throw badRequest('Date range cannot exceed one year');
  const b = await Business.findById(req.tenant!.businessId, { compliance: 1 }).lean();
  res.json(await analytics(req.tenant!.businessId, from, to, b?.compliance?.timezone ?? 'Asia/Kolkata'));
});

/* ---------------------------- Notifications --------------------------- */
export const notificationsRouter = Router();
const mine = (req: any) => ({ ...scope(req), $or: [{ userId: req.auth.userId }, { userId: { $exists: false } }, { userId: null }] });
notificationsRouter.get('/', async (req, res) => {
  const items = await Notification.find(mine(req)).sort({ createdAt: -1 }).limit(50).lean();
  const uid = req.auth!.userId;
  res.json({ items: items.map((n) => ({ ...n, read: (n.readBy ?? []).some((r) => String(r) === uid) })), unread: items.filter((n) => !(n.readBy ?? []).some((r) => String(r) === uid)).length });
});
notificationsRouter.post('/read', async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(200).optional() }), req.body ?? {});
  await Notification.updateMany({ ...mine(req), ...(ids?.length ? { _id: { $in: ids } } : {}) }, { $addToSet: { readBy: req.auth!.userId } });
  res.json({ ok: true });
});

/* ---------------------- Compliance: DNC + audit ---------------------- */
export const complianceRouter = Router();
complianceRouter.get('/dnc', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query as any);
  const [items, total] = await Promise.all([DncEntry.find(scope(req)).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), DncEntry.countDocuments(scope(req))]);
  res.json({ items: items.map(({ phoneHash: _h, ...r }) => r), total, page, limit });
});
complianceRouter.post('/dnc', requirePermission('compliance:write'), async (req, res) => {
  const body = parse(z.object({ phones: z.array(z.string().max(30)).min(1).max(5000), reason: z.enum(['manual', 'registry', 'complaint', 'opt_out']).default('manual') }), req.body);
  let added = 0; const invalid: string[] = [];
  for (const raw of body.phones) {
    const e = toE164(raw);
    if (!e) { invalid.push(raw); continue; }
    const r = await DncEntry.updateOne({ ...scope(req), phoneHash: blindIndex(e) }, { $setOnInsert: { ...scope(req), phoneHash: blindIndex(e), phoneMasked: maskPhone(e), reason: body.reason, source: 'manual', addedBy: req.auth!.userId } }, { upsert: true });
    if (r.upsertedCount) added++;
    const lead = await Lead.findOne({ ...scope(req), phoneHash: blindIndex(e) });
    if (lead) await addToDnc(req.tenant!.businessId, lead, body.reason, 'manual', req.auth!.userId);
  }
  await audit(req, 'compliance.dnc_added', 'DncEntry', undefined, { added, invalid: invalid.length });
  res.status(201).json({ added, invalid });
});
complianceRouter.post('/dnc/import', requirePermission('compliance:write'), async (req, res) => {
  const { csv } = parse(z.object({ csv: z.string().max(2_000_000) }), req.body);
  const rows = parseCsv(csv.includes(',') || csv.includes('\n') ? (csv.split('\n')[0].toLowerCase().includes('phone') ? csv : 'phone\n' + csv) : 'phone\n' + csv);
  req.body = { phones: rows.map((r) => r.phone ?? Object.values(r)[0]).filter(Boolean), reason: 'registry' };
  const phones = req.body.phones as string[];
  let added = 0;
  for (const raw of phones) {
    const e = toE164(raw); if (!e) continue;
    const r = await DncEntry.updateOne({ ...scope(req), phoneHash: blindIndex(e) }, { $setOnInsert: { ...scope(req), phoneHash: blindIndex(e), phoneMasked: maskPhone(e), reason: 'registry', source: 'import', addedBy: req.auth!.userId } }, { upsert: true });
    if (r.upsertedCount) added++;
    await Lead.updateMany({ ...scope(req), phoneHash: blindIndex(e) }, { doNotCall: true });
  }
  await audit(req, 'compliance.dnc_import', 'DncEntry', undefined, { rows: phones.length, added });
  res.status(201).json({ rows: phones.length, added });
});
complianceRouter.delete('/dnc/:id', requirePermission('compliance:write'), async (req, res) => {
  const d = await DncEntry.findOne({ ...scope(req), _id: req.params.id });
  if (!d) throw notFound('Entry');
  if (d.reason === 'opt_out') throw badRequest('Entries created by a customer opt-out cannot be removed');
  await DncEntry.deleteOne({ ...scope(req), _id: d._id });
  await audit(req, 'compliance.dnc_removed', 'DncEntry', d._id);
  res.status(204).end();
});
complianceRouter.get('/audit', requirePermission('audit:read'), async (req, res) => {
  const { page, limit, skip } = pageParams(req.query as any);
  const f: any = scope(req);
  if (req.query.action) f.action = new RegExp('^' + String(req.query.action).replace(/[^\w.]/g, ''));
  const [items, total] = await Promise.all([AuditLog.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'name email').lean(), AuditLog.countDocuments(f)]);
  res.json({ items, total, page, limit });
});

/* ---------------------------- System status --------------------------- */
export const systemRouter = Router();
systemRouter.get('/status', async (_req, res) => {
  res.json({
    llm: getLLM()?.name ?? 'local (rule-based — set OPENAI_API_KEY for full AI)',
    embeddings: getEmbeddings().model,
    telephony: env.TELEPHONY_PROVIDER,
    leadProviders: listLeadProviders(),
    email: env.SMTP_HOST ? 'smtp' : 'console',
    calendar: env.GOOGLE_CALENDAR_REFRESH_TOKEN ? 'google' : 'ics-email',
  });
});
