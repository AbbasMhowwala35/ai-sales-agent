import { Business, Lead, LeadSource, DncEntry } from '../../models/index.js';
import { getLeadProvider, leadProviders } from '../../providers/leads/index.js';
import type { DiscoveryQuery, RawLead } from '../../providers/leads/types.js';
import { normalizeLead, type NormalizedLead } from './normalize.js';
import { findDuplicate, dedupeBatch } from './dedupe.js';
import { scoreLead } from './scoring.js';
import { blindIndex } from '../../lib/crypto.js';
import { logActivity } from '../activity.js';
import { notify } from '../notifications.js';
import { getLLM } from '../../providers/llm/index.js';
import { Campaign, CampaignLead } from '../../models/index.js';
import { clock } from '../../lib/clock.js';

/** Research runs owned by a campaign: auto-approve leads above the campaign’s score bar and queue them for calling. */
async function feedCampaign(businessId: string, campaignId: string, leadIds: string[]) {
  const c = await Campaign.findOne({ businessId, _id: campaignId }).lean();
  if (!c || !leadIds.length) return 0;
  const min = c.research?.autoApproveMinScore ?? 60;
  const good = await Lead.find({ businessId, _id: { $in: leadIds }, score: { $gte: min }, doNotCall: false }, { _id: 1 }).lean();
  if (!good.length) return 0;
  await Lead.updateMany({ businessId, _id: { $in: good.map((l) => l._id) } }, { approval: 'approved', campaignId, ...(c.category ? { category: c.category } : {}) });
  await CampaignLead.insertMany(good.map((l) => ({ businessId, campaignId, leadId: l._id, status: 'queued', attempts: 0, nextAttemptAt: clock.now() })), { ordered: false }).catch(() => undefined);
  await Campaign.updateOne({ businessId, _id: campaignId }, { $inc: { 'research.totalFound': leadIds.length, 'research.totalAdded': good.length } });
  return good.length;
}

export function buildQuery(business: any, overrides: Partial<DiscoveryQuery> = {}): DiscoveryQuery {
  const icp = business.icp ?? {};
  return {
    keywords: overrides.keywords?.length ? overrides.keywords : icp.keywords?.length ? icp.keywords : (icp.industries ?? []),
    industries: overrides.industries?.length ? overrides.industries : icp.industries ?? [],
    locations: overrides.locations?.length ? overrides.locations : business.targetLocations ?? [],
    roles: overrides.roles?.length ? overrides.roles : icp.roles ?? [],
    companySizes: overrides.companySizes?.length ? overrides.companySizes : icp.companySizes ?? [],
    limit: Math.min(200, overrides.limit ?? 25),
  };
}

/** Optionally expand ICP into better search keywords with the LLM. */
async function expandKeywords(business: any, q: DiscoveryQuery) {
  const llm = getLLM();
  if (!llm || q.keywords.length >= 5) return q;
  try {
    const r = await llm.chat([
      { role: 'system', content: 'Return JSON {"keywords": string[]} with up to 5 short business-directory search terms for finding ideal customers.' },
      { role: 'user', content: `We sell: ${business.description ?? ''}\nProducts: ${(business.products ?? []).map((p: any) => p.name).join(', ')}\nTarget audience: ${business.targetAudience ?? ''}\nIndustries: ${q.industries.join(', ')}` },
    ], { json: true, temperature: 0.3, maxTokens: 150 });
    const kws = JSON.parse(r.content).keywords;
    if (Array.isArray(kws)) q.keywords = [...new Set([...q.keywords, ...kws.map(String)])].slice(0, 8);
  } catch { /* fall back to ICP keywords */ }
  return q;
}

export function resolveProvider(id: string) {
  if (id === 'auto') return leadProviders.find((p) => p.id !== 'sandbox' && p.configured()) ?? leadProviders.find((p) => p.configured());
  const p = getLeadProvider(id);
  return p?.configured() ? p : undefined;
}

/** Normalise → de-dupe → DNC check → score → store. Shared by discovery providers and CSV import. */
export async function ingestLeads(business: any, raws: RawLead[], source: string, runId?: unknown, userId?: unknown, category?: string) {
  const businessId = business._id;
  const normalized = raws.filter((r) => r.companyName?.trim()).map((r) => normalizeLead(r));
  const { leads, dupes: batchDupes } = dedupeBatch(normalized);
  let created = 0, duplicates = batchDupes, rejected = 0;
  const createdIds: string[] = [];
  const requirePhone = business.qualification?.requirePhone ?? true;
  const autoApprove = business.qualification?.autoApproveAbove ?? 0;
  for (const l of leads as NormalizedLead[]) {
    if (requirePhone && !l.phone) { rejected++; continue; }
    if (await findDuplicate(businessId, l)) { duplicates++; continue; }
    const s = scoreLead(l, business);
    const dnc = l.phone ? await DncEntry.exists({ businessId, phoneHash: blindIndex(l.phone) }) : null;
    try {
      const lead = await Lead.create({
        ...l, businessId, source, discoveryRunId: runId, category: l.category || category || undefined,
        score: s.score, temperature: s.temperature, scoreBreakdown: s.breakdown,
        status: s.temperature !== 'cold' ? 'qualified' : 'new',
        approval: autoApprove > 0 && s.score >= autoApprove && !dnc ? 'approved' : 'pending',
        doNotCall: !!dnc,
        tags: source === 'sandbox' ? ['sandbox'] : [],
      });
      created++; createdIds.push(String(lead._id));
      await logActivity(businessId, lead._id, 'created', `Lead discovered via ${source} — score ${s.score} (${s.temperature})`, { breakdown: s.breakdown }, userId);
    } catch (e: any) {
      if (e?.code === 11000) duplicates++; else throw e;
    }
  }
  if (createdIds.length && business.priorityRules?.length) {
    const { enqueue } = await import('../../queue/queue.js');
    await enqueue('leads.prioritize', { leadIds: createdIds }, { businessId, maxAttempts: 2 });
  }
  return { found: raws.length, created, duplicates, rejected, createdIds };
}

export async function runDiscovery(businessId: string, runId: string) {
  const run = await LeadSource.findOne({ businessId, _id: runId });
  if (!run) return;
  const business = await Business.findById(businessId).lean();
  const provider = resolveProvider(run.provider);
  run.status = 'running'; run.startedAt = new Date();
  await run.save();
  try {
    if (!provider) throw new Error(`Lead provider "${run.provider}" is not configured. Add its API key in the server environment.`);
    const q = await expandKeywords(business, buildQuery(business, run.query as any));
    run.query = q;
    const raws = await provider.discover(q);
    const camp = run.campaignId ? await Campaign.findOne({ businessId, _id: run.campaignId }, { category: 1 }).lean() : null;
    const r = await ingestLeads(business, raws, provider.id, run._id, run.requestedBy, run.category ?? camp?.category ?? (q.keywords[0] ? q.keywords[0].replace(/^./, (c: string) => c.toUpperCase()) : undefined));
    let added = 0;
    if (run.campaignId) added = await feedCampaign(businessId, String(run.campaignId), r.createdIds);
    Object.assign(run, { found: r.found, created: r.created, duplicates: r.duplicates, rejected: r.rejected, added, status: 'completed', finishedAt: new Date() });
    await run.save();
    await notify(businessId, { type: 'success', title: 'Lead discovery finished', message: `${r.created} new leads from ${provider.label} (${r.duplicates} duplicates skipped)`, link: '/leads?approval=pending' });
  } catch (e: any) {
    run.status = 'failed'; run.error = e.message?.slice(0, 500); run.finishedAt = new Date();
    await run.save();
    await notify(businessId, { type: 'error', title: 'Lead discovery failed', message: run.error, link: '/lead-generation' });
  }
}
