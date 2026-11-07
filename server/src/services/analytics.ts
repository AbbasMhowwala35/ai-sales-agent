import { Types } from 'mongoose';
import { Lead, Call, Appointment, Campaign, AIAgent } from '../models/index.js';

export async function analytics(businessId: Types.ObjectId, from: Date, to: Date, tz = 'Asia/Kolkata') {
  const range = { $gte: from, $lte: to };
  const [leadAgg, leadStatus, callAgg, callDaily, leadDaily, appts, campaignAgg, agentAgg, sentiment, sources, temperature] = await Promise.all([
    Lead.aggregate([{ $match: { businessId, createdAt: range } }, { $group: { _id: null, total: { $sum: 1 }, qualified: { $sum: { $cond: [{ $in: ['$temperature', ['hot', 'warm']] }, 1, 0] } }, approved: { $sum: { $cond: [{ $eq: ['$approval', 'approved'] }, 1, 0] } } } }]),
    Lead.aggregate([{ $match: { businessId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Call.aggregate([{ $match: { businessId, direction: 'outbound', createdAt: range } }, { $group: { _id: null, total: { $sum: 1 }, answered: { $sum: { $cond: [{ $eq: ['$result', 'answered'] }, 1, 0] } }, missed: { $sum: { $cond: [{ $in: ['$result', ['missed', 'voicemail']] }, 1, 0] } }, busy: { $sum: { $cond: [{ $eq: ['$result', 'busy'] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ['$result', 'failed'] }, 1, 0] } }, interested: { $sum: { $cond: ['$qualification.interested', 1, 0] } }, totalDuration: { $sum: { $cond: [{ $eq: ['$result', 'answered'] }, '$durationSec', 0] } }, optOuts: { $sum: { $cond: ['$optOut', 1, 0] } } } }]),
    Call.aggregate([{ $match: { businessId, direction: 'outbound', createdAt: range } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } }, total: { $sum: 1 }, answered: { $sum: { $cond: [{ $eq: ['$result', 'answered'] }, 1, 0] } }, interested: { $sum: { $cond: ['$qualification.interested', 1, 0] } } } }, { $sort: { _id: 1 } }]),
    Lead.aggregate([{ $match: { businessId, createdAt: range } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } }, leads: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Appointment.aggregate([{ $match: { businessId, createdAt: range } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    Call.aggregate([{ $match: { businessId, direction: 'outbound', createdAt: range, campaignId: { $exists: true } } }, { $group: { _id: '$campaignId', calls: { $sum: 1 }, answered: { $sum: { $cond: [{ $eq: ['$result', 'answered'] }, 1, 0] } }, interested: { $sum: { $cond: ['$qualification.interested', 1, 0] } }, meetings: { $sum: { $cond: [{ $ifNull: ['$appointmentId', false] }, 1, 0] } }, duration: { $sum: '$durationSec' } } }]),
    Call.aggregate([{ $match: { businessId, direction: 'outbound', createdAt: range } }, { $group: { _id: '$agentId', calls: { $sum: 1 }, answered: { $sum: { $cond: [{ $eq: ['$result', 'answered'] }, 1, 0] } }, interested: { $sum: { $cond: ['$qualification.interested', 1, 0] } }, meetings: { $sum: { $cond: [{ $ifNull: ['$appointmentId', false] }, 1, 0] } }, avgSentiment: { $avg: '$sentiment.score' }, duration: { $sum: '$durationSec' } } }]),
    Call.aggregate([{ $match: { businessId, direction: 'outbound', createdAt: range, 'sentiment.label': { $exists: true } } }, { $group: { _id: '$sentiment.label', n: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: { businessId, createdAt: range } }, { $group: { _id: '$source', n: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: { businessId, createdAt: range } }, { $group: { _id: '$temperature', n: { $sum: 1 } } }]),
  ]);
  const l = leadAgg[0] ?? { total: 0, qualified: 0, approved: 0 };
  const c = callAgg[0] ?? { total: 0, answered: 0, missed: 0, busy: 0, failed: 0, interested: 0, totalDuration: 0, optOuts: 0 };
  const status = Object.fromEntries(leadStatus.map((s) => [s._id, s.n]));
  const totalLeadsAll = Object.values(status).reduce((a: number, b: any) => a + b, 0) as number;
  const meetings = appts.find((a) => a._id === 'meeting')?.n ?? 0;
  const [campaigns, agents] = await Promise.all([
    Campaign.find({ businessId, _id: { $in: campaignAgg.map((x) => x._id) } }, { name: 1, status: 1 }).lean(),
    AIAgent.find({ businessId, _id: { $in: agentAgg.map((x) => x._id).filter(Boolean) } }, { name: 1 }).lean(),
  ]);
  // fill days
  const days: string[] = [];
  for (let d = new Date(from); d <= to && days.length < 370; d = new Date(d.getTime() + 86400_000)) days.push(d.toLocaleDateString('en-CA', { timeZone: tz }));
  const daily = [...new Set(days)].map((day) => ({ day, ...{ total: 0, answered: 0, interested: 0 }, ...(callDaily.find((x) => x._id === day) ?? {}), leads: leadDaily.find((x) => x._id === day)?.leads ?? 0, _id: undefined }));
  return {
    range: { from, to },
    summary: {
      leadsDiscovered: l.total, qualifiedLeads: l.qualified, approvedLeads: l.approved,
      callsInitiated: c.total, connected: c.answered, missed: c.missed, busy: c.busy, failed: c.failed,
      connectRate: c.total ? +(c.answered / c.total * 100).toFixed(1) : 0,
      interested: c.interested, meetingsScheduled: meetings, callbacks: appts.find((a) => a._id === 'callback')?.n ?? 0,
      conversionRate: totalLeadsAll ? +(((status.converted ?? 0) / totalLeadsAll) * 100).toFixed(1) : 0,
      converted: status.converted ?? 0,
      avgCallDuration: c.answered ? Math.round(c.totalDuration / c.answered) : 0,
      optOuts: c.optOuts,
    },
    funnel: ['new', 'qualified', 'contacted', 'interested', 'meeting_scheduled', 'converted', 'lost'].map((s) => ({ stage: s, count: status[s] ?? 0 })),
    daily,
    callOutcomes: [{ name: 'Answered', value: c.answered }, { name: 'Missed', value: c.missed }, { name: 'Busy', value: c.busy }, { name: 'Failed', value: c.failed }],
    sentiment: ['positive', 'neutral', 'negative'].map((s) => ({ name: s, value: sentiment.find((x) => x._id === s)?.n ?? 0 })),
    sources: sources.map((s) => ({ name: s._id, value: s.n })),
    temperature: ['hot', 'warm', 'cold'].map((t) => ({ name: t, value: temperature.find((x) => x._id === t)?.n ?? 0 })),
    campaigns: campaignAgg.map((x) => ({ id: x._id, name: campaigns.find((c) => String(c._id) === String(x._id))?.name ?? 'Deleted campaign', status: campaigns.find((c) => String(c._id) === String(x._id))?.status, calls: x.calls, answered: x.answered, interested: x.interested, meetings: x.meetings, connectRate: x.calls ? +(x.answered / x.calls * 100).toFixed(1) : 0, avgDuration: x.answered ? Math.round(x.duration / x.answered) : 0 })),
    agents: agentAgg.map((x) => ({ id: x._id, name: agents.find((a) => String(a._id) === String(x._id))?.name ?? 'Agent', calls: x.calls, answered: x.answered, interested: x.interested, meetings: x.meetings, interestRate: x.answered ? +(x.interested / x.answered * 100).toFixed(1) : 0, avgSentiment: x.avgSentiment !== null ? +(x.avgSentiment ?? 0).toFixed(2) : null, avgDuration: x.answered ? Math.round(x.duration / x.answered) : 0 })),
  };
}
