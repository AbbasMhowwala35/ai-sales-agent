import { tp } from '../../lib/tenant.js';
import { Campaign, CampaignLead, Call, Business, Lead, Reminder } from '../../models/index.js';
import { createAndQueueCall } from '../calls/lifecycle.js';
import { canCall } from '../calls/compliance.js';
import { notify } from '../notifications.js';
import { logger } from '../../lib/logger.js';
import { DateTime } from 'luxon';
import { clock } from '../../lib/clock.js';

/**
 * Campaign dispatcher — runs every SCHEDULER_TICK_MS. For each active auto-calling campaign:
 * respects schedule window, daily limit and max concurrency; picks due leads; re-checks compliance; queues dials.
 */
export async function schedulerTick(now = clock.now()) {
  const campaigns = await Campaign.find({ status: 'active', autoCalling: true }).setOptions({ crossTenant: true }).lean();
  let queued = 0;
  for (const c of campaigns) {
    try { queued += await dispatchCampaign(c, now); } catch (e: any) { logger.error({ campaignId: c._id, err: e.message }, 'dispatch failed'); }
  }
  await fireReminders(now);
  queued += await dispatchFollowUps(now);
  await runCampaignResearch(now);
  return queued;
}

export async function dispatchCampaign(c: any, now = clock.now()) {
  const businessId = c.businessId;
  // Acquire a short lease (wall-clock) so concurrent schedulers / processes can't overrun limits.
  const wall = Date.now();
  const lease = await Campaign.findOneAndUpdate(
    { businessId, _id: c._id, status: 'active', $or: [{ dispatchLockUntil: { $exists: false } }, { dispatchLockUntil: null }, { dispatchLockUntil: { $lt: new Date(wall) } }] },
    { dispatchLockUntil: new Date(wall + 60_000) },
  );
  if (!lease) return 0;
  try {
    return await dispatchLocked(c, businessId, now);
  } finally {
    await Campaign.updateOne({ businessId, _id: c._id }, { $unset: { dispatchLockUntil: 1 } });
  }
}

async function dispatchLocked(c: any, businessId: any, now: Date) {
  const business = await Business.findById(businessId).lean();
  if (!business) return 0;
  const tz = c.schedule?.timezone ?? 'Asia/Kolkata';
  const dayStart = DateTime.fromJSDate(now).setZone(tz).startOf('day').toJSDate();
  const [today, inFlight] = await Promise.all([
    Call.countDocuments({ businessId, campaignId: c._id, queuedAt: { $gte: dayStart } }),
    Call.countDocuments({ businessId, campaignId: c._id, status: { $in: ['queued', 'ringing', 'in_progress'] } }),
  ]);
  const slots = Math.min(c.dailyLimit - today, c.maxConcurrent - inFlight);

  const remaining = await CampaignLead.countDocuments({ businessId, campaignId: c._id, status: { $in: ['queued', 'retry', 'calling'] } });
  const ended = c.endDate && new Date(c.endDate) < now;
  const stillResearching = c.research?.enabled && !ended;
  if (ended || (remaining === 0 && inFlight === 0 && !stillResearching)) {
    if (ended) await CampaignLead.updateMany({ businessId, campaignId: c._id, status: { $in: ['queued', 'retry'] } }, { status: 'skipped', skipReason: 'Campaign end date reached' });
    await Campaign.updateOne({ businessId, _id: c._id, status: 'active' }, { status: 'completed', completedAt: now });
    await notify(businessId, { type: 'success', title: 'Campaign completed', message: c.name, link: `/campaigns/${c._id}` });
    return 0;
  }
  if (slots <= 0) return 0;

  const due = await CampaignLead.find({ businessId, campaignId: c._id, status: { $in: ['queued', 'retry'] }, nextAttemptAt: { $lte: now } }).sort({ nextAttemptAt: 1 }).limit(slots * 3).lean();
  let queued = 0;
  for (const cl of due) {
    if (queued >= slots) break;
    const lead = await Lead.findOne({ businessId, _id: cl.leadId });
    if (!lead) { await CampaignLead.updateOne({ businessId, _id: cl._id }, { status: 'skipped', skipReason: 'Lead deleted' }); continue; }
    const check = await canCall(lead, business, c, { now });
    if (!check.ok) {
      if (check.retryable) {
        // outside a window: try again later without consuming an attempt
        await CampaignLead.updateOne({ businessId, _id: cl._id }, { nextAttemptAt: new Date(now.getTime() + 15 * 60_000) });
      } else await CampaignLead.updateOne({ businessId, _id: cl._id }, { status: 'skipped', skipReason: check.reason });
      continue;
    }
    // claim atomically so concurrent schedulers never double-dial
    const claimed = await CampaignLead.findOneAndUpdate({ businessId, _id: cl._id, status: { $in: ['queued', 'retry'] } }, { status: 'calling', $inc: { attempts: 1 } }, { returnDocument: 'after' });
    if (!claimed) continue;
    const { call, check: c2 } = await createAndQueueCall({ businessId, leadId: lead._id, agentId: c.agentId, campaignId: c._id, campaignLeadId: claimed._id, attempt: claimed.attempts });
    if (!call) await CampaignLead.updateOne({ businessId, _id: cl._id }, { status: c2.retryable ? 'queued' : 'skipped', skipReason: c2.reason, $inc: { attempts: -1 }, nextAttemptAt: new Date(now.getTime() + 15 * 60_000) });
    else queued++;
  }
  return queued;
}

async function fireReminders(now: Date) {
  const due = await Reminder.find({ done: false, notified: false, dueAt: { $lte: now } }).setOptions({ crossTenant: true }).limit(200).populate(tp('leadId', 'companyName')).lean();
  for (const r of due) {
    await notify(r.businessId, { userId: r.userId, type: 'reminder', title: `Follow up: ${(r.leadId as any)?.companyName ?? 'lead'}`, message: r.note ?? 'Scheduled follow-up is due', link: `/leads/${(r.leadId as any)?._id ?? r.leadId}` });
    await Reminder.updateOne({ businessId: r.businessId, _id: r._id }, { notified: true });
  }
}

let timer: NodeJS.Timeout | null = null;
export function startScheduler(ms: number) {
  if (timer) return;
  timer = setInterval(() => void schedulerTick().catch((e) => logger.error(e, 'scheduler')), ms);
}
export function stopScheduler() { if (timer) clearInterval(timer); timer = null; }

/**
 * Follow-up dispatcher: prospects who asked for a callback at a time, or said “not now — try me in N months”,
 * are called again automatically when that moment arrives (inside their local calling window).
 */
export async function dispatchFollowUps(now = clock.now()) {
  const due = await Lead.find({
    outcome: { $in: ['callback', 'nurture', 'interested'] }, followUpAt: { $lte: now }, approval: 'approved', doNotCall: false,
    $or: [{ followUpQueuedAt: null }, { followUpQueuedAt: { $exists: false } }],
  }).setOptions({ crossTenant: true }).limit(500);
  let queued = 0;
  const perBiz = new Map<string, number>();
  for (const lead of due) {
    const bid = String(lead.businessId);
    const business = await Business.findById(bid).lean();
    if (!business) continue;
    const f = business.followUps ?? {};
    if (lead.outcome === 'callback' && f.autoCallBack === false) continue;
    if (lead.outcome === 'nurture' && f.autoNurture === false) continue;
    if (lead.outcome === 'interested') { // interested-without-meeting: remind a human instead of auto-calling
      await notify(bid, { userId: lead.assignedTo, type: 'reminder', title: `Follow up: ${lead.companyName}`, message: lead.outcomeNote ?? 'Interested prospect — send details and follow up', link: `/leads/${lead._id}` });
      await Lead.updateOne({ businessId: bid, _id: lead._id }, { followUpQueuedAt: now });
      continue;
    }
    const used = perBiz.get(bid) ?? 0;
    if (used >= (f.dailyLimit ?? 50)) continue;
    const check = await canCall(lead, business, null, { now });
    if (!check.ok) {
      if (!check.retryable) await Lead.updateOne({ businessId: bid, _id: lead._id }, { followUpQueuedAt: now, outcomeNote: `${lead.outcomeNote ?? ''} (follow-up blocked: ${check.reason})` });
      continue; // outside their hours → try again next tick
    }
    const { call } = await createAndQueueCall({ businessId: bid, leadId: lead._id, agentId: lead.lastAgentId ?? undefined });
    if (call) {
      queued++; perBiz.set(bid, used + 1);
      await Lead.updateOne({ businessId: bid, _id: lead._id }, { followUpQueuedAt: now });
      await notify(bid, { userId: lead.assignedTo, type: 'info', title: lead.outcome === 'callback' ? 'Calling back as promised' : 'Following up after “not now”', message: lead.companyName, link: `/leads/${lead._id}` });
    }
  }
  return queued;
}

const FREQ_MS = { daily: 86400_000, weekly: 7 * 86400_000, monthly: 30 * 86400_000 } as const;

/** Campaign research: each active campaign with research enabled discovers fresh prospects on its cadence until its end date. */
export async function runCampaignResearch(now = clock.now()) {
  const camps = await Campaign.find({ status: { $in: ['active', 'paused'] }, 'research.enabled': true }).setOptions({ crossTenant: true }).lean();
  for (const c of camps) {
    if (c.endDate && c.endDate < now) continue;
    const r = c.research!;
    if (r.nextRunAt && r.nextRunAt > now) continue;
    const { LeadSource } = await import('../../models/index.js');
    const { enqueue } = await import('../../queue/queue.js');
    const running = await LeadSource.exists({ businessId: c.businessId, campaignId: c._id, status: { $in: ['queued', 'running'] } });
    if (running) continue;
    const run = await LeadSource.create({
      businessId: c.businessId, campaignId: c._id, provider: r.provider ?? 'auto', requestedBy: c.createdBy,
      query: { keywords: r.keywords, industries: r.industries, locations: r.locations?.length ? r.locations : r.countries, roles: r.roles, limit: r.leadsPerRun ?? 25 },
    });
    await Campaign.updateOne({ businessId: c.businessId, _id: c._id }, { 'research.lastRunAt': now, 'research.nextRunAt': new Date(now.getTime() + FREQ_MS[(r.frequency ?? 'daily') as keyof typeof FREQ_MS]) });
    await enqueue('leads.discover', { runId: String(run._id) }, { businessId: c.businessId, maxAttempts: 2, uniqueKey: `research:${run._id}` });
  }
}
