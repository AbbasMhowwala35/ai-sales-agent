import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { LeadSource, Business } from '../models/index.js';
import { scope } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { parse } from '../lib/validate.js';
import { badRequest } from '../lib/errors.js';
import { enqueue } from '../queue/queue.js';
import { listLeadProviders } from '../providers/leads/index.js';
import { buildQuery, ingestLeads, resolveProvider } from '../services/leads/discovery.js';
import { parseCsv } from '../lib/csv.js';
import { audit } from '../services/audit.js';
import { GEO } from '../lib/geo.js';

export const leadgenRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const strArr = z.array(z.string().trim().min(1).max(120)).max(30).optional();

leadgenRouter.get('/geo', (_req, res) => { res.setHeader('cache-control', 'private, max-age=3600'); res.json({ countries: GEO }); });

leadgenRouter.get('/providers', async (_req, res) => {
  res.json({ providers: listLeadProviders() });
});

leadgenRouter.get('/runs', async (req, res) => {
  res.json({ runs: await LeadSource.find(scope(req)).sort({ createdAt: -1 }).limit(50).lean() });
});

/** Example CSV for “Import your own list”. */
leadgenRouter.get('/sample.csv', (_req, res) => {
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', 'attachment; filename="lead-import-sample.csv"');
  res.send([
    'company,name,title,phone,email,website,city,state,country,industry,category,notes',
    'Luxe Hair Studio,Emily Johnson,Owner,+1 512 555 0142,emily@luxehair.com,https://luxehair.com,Austin,TX,USA,Beauty,Salons,Met at Austin Beauty Expo',
    'Bloom Nail Lounge,Jessica Martinez,Salon Manager,+1 305 555 0187,,,Miami,FL,USA,Beauty,Salons,No website yet',
    'Willow Day Spa,Sophie Clarke,Founder,+44 20 7946 0321,sophie@willowspa.co.uk,https://willowspa.co.uk,London,,United Kingdom,Beauty,Spas,Asked for a callback in January',
  ].join('\n'));
});

leadgenRouter.get('/preview-query', async (req, res) => {
  const b = await Business.findById(req.tenant!.businessId).lean();
  res.json(buildQuery(b));
});

leadgenRouter.post('/runs', requirePermission('leadgen:run'), async (req, res) => {
  const body = parse(z.object({
    provider: z.string().default('auto'),
    keywords: strArr, industries: strArr, locations: strArr, roles: strArr, companySizes: strArr,
    limit: z.number().int().min(1).max(200).default(25),
    category: z.string().trim().max(60).optional(),
  }), req.body);
  const provider = resolveProvider(body.provider);
  if (!provider) throw badRequest(`Lead source "${body.provider}" is not configured. Add its API key to the server .env or choose another source.`);
  const running = await LeadSource.countDocuments({ ...scope(req), status: { $in: ['queued', 'running'] } });
  if (running >= 3) throw badRequest('Up to 3 discovery runs can be in progress at once. Please wait for one to finish.');
  const { provider: _p, category, ...query } = body;
  const run = await LeadSource.create({ ...scope(req), provider: provider.id, query, category, requestedBy: req.auth!.userId });
  await enqueue('leads.discover', { runId: String(run._id) }, { businessId: req.tenant!.businessId, maxAttempts: 2 });
  await audit(req, 'leadgen.started', 'LeadSource', run._id, { provider: provider.id });
  res.status(202).json(run);
});

/** CSV import of leads the business already has permission to contact (e.g. CRM export, event sign-ups). */
leadgenRouter.post('/import', requirePermission('leadgen:run'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Attach a CSV file');
  const rows = parseCsv(req.file.buffer.toString('utf8'));
  if (!rows.length) throw badRequest('CSV is empty');
  const pick = (r: Record<string, string>, ...keys: string[]) => { for (const k of keys) { const v = r[k]; if (v) return v; } return undefined; };
  const raws = rows.map((r) => ({
    companyName: pick(r, 'company', 'company name', 'companyname', 'organization', 'business')!,
    contactName: pick(r, 'name', 'contact', 'contact name', 'full name'),
    designation: pick(r, 'title', 'designation', 'role', 'job title'),
    email: pick(r, 'email', 'business email', 'email address'),
    phone: pick(r, 'phone', 'phone number', 'mobile', 'telephone'),
    website: pick(r, 'website', 'url', 'domain'),
    city: pick(r, 'city'), state: pick(r, 'state'), country: pick(r, 'country'),
    industry: pick(r, 'industry'), companySize: pick(r, 'size', 'company size', 'employees'),
    description: pick(r, 'notes', 'description'),
    category: pick(r, 'category'),
  }));
  const consent = req.body?.consent === 'granted';
  const b = await Business.findById(req.tenant!.businessId).lean();
  const run = await LeadSource.create({ ...scope(req), provider: 'csv_import', query: { file: req.file.originalname, rows: rows.length }, status: 'running', startedAt: new Date(), requestedBy: req.auth!.userId });
  const category = String(req.body?.category ?? '').trim().slice(0, 60) || undefined; // per-row “category” column wins
  const r = await ingestLeads(b, raws, 'csv_import', run._id, req.auth!.userId, category);
  if (consent && r.createdIds.length) {
    const { Lead } = await import('../models/index.js');
    await Lead.updateMany({ ...scope(req), _id: { $in: r.createdIds } }, { consent: 'granted' });
  }
  Object.assign(run, { found: r.found, created: r.created, duplicates: r.duplicates, rejected: r.rejected, status: 'completed', finishedAt: new Date() });
  await run.save();
  await audit(req, 'leadgen.csv_import', 'LeadSource', run._id, { rows: rows.length, created: r.created });
  res.status(201).json(run);
});

export async function discoverJob(p: { runId: string }, job: { businessId?: string }) {
  const { runDiscovery } = await import('../services/leads/discovery.js');
  await runDiscovery(job.businessId!, p.runId);
}
