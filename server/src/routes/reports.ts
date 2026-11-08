import { Router, type Response } from 'express';
import { brandName } from '../lib/brand.js';
import { DateTime } from 'luxon';
import { Business, Campaign, CampaignLead, Call, CallTranscript, Lead } from '../models/index.js';
import { scope } from '../middleware/auth.js';
import { analytics } from '../services/analytics.js';
import { Report, COLORS, clean } from '../services/reports/pdf.js';
import { badRequest, notFound } from '../lib/errors.js';
import { tp } from '../lib/tenant.js';
import { audit } from '../services/audit.js';
import { leadTimezone } from '../services/calls/compliance.js';

export const reportsRouter = Router();

export const OUTCOME_LABEL: Record<string, string> = {
  none: 'Not contacted yet', meeting: 'Meeting booked', interested: 'Interested', callback: 'Call back requested', nurture: 'Follow up later',
  busy: 'Busy - retrying', no_answer: 'No answer - retrying', not_interested: 'Not interested (closed)', do_not_call: 'Do not call',
};
const OUTCOME_COLOR: Record<string, string> = { meeting: COLORS.signal, interested: COLORS.signal, callback: COLORS.hot, nurture: COLORS.cold, not_interested: COLORS.muted, do_not_call: COLORS.danger };
const d = (x?: Date | string | null, tz = 'UTC') => (x ? DateTime.fromJSDate(new Date(x)).setZone(tz).toFormat('d LLL yyyy, h:mm a') : '-');
const dur = (s?: number) => `${Math.floor((s ?? 0) / 60)}:${String(Math.round((s ?? 0) % 60)).padStart(2, '0')}`;

async function send(res: Response, r: Report, filename: string) {
  const buf = await r.toBuffer();
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.setHeader('cache-control', 'no-store');
  res.send(buf);
}

reportsRouter.get('/analytics.pdf', async (req, res) => {
  const q = req.query as Record<string, string>;
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 29 * 86400_000);
  if (isNaN(+from) || isNaN(+to) || from > to) throw badRequest('Invalid date range');
  const b = await Business.findById(req.tenant!.businessId).lean();
  const tz = b?.compliance?.timezone ?? 'UTC';
  const a = await analytics(req.tenant!.businessId, from, to, tz);
  const s = a.summary;
  const r = new Report('Sales performance report', `${DateTime.fromJSDate(from).toFormat('d LLL yyyy')} - ${DateTime.fromJSDate(to).toFormat('d LLL yyyy')}`, clean(brandName(b)));
  r.section('Headline numbers');
  r.kpis([
    { label: 'Leads discovered', value: s.leadsDiscovered, sub: `${s.qualifiedLeads} qualified` },
    { label: 'Calls made', value: s.callsInitiated, sub: `${s.connectRate}% connected` },
    { label: 'Conversations', value: s.connected, sub: `avg ${dur(s.avgCallDuration)}` },
    { label: 'Meetings booked', value: s.meetingsScheduled, sub: `${s.callbacks} callbacks`, accent: true },
    { label: 'Interested', value: s.interested },
    { label: 'Converted', value: s.converted },
    { label: 'Conversion rate', value: `${s.conversionRate}%` },
    { label: 'Opt-outs honoured', value: s.optOuts },
  ]);
  r.section('Daily calling activity', 'Blue: calls placed · Teal: connected');
  r.columns(a.daily.map((x: any) => ({ label: DateTime.fromISO(x.day).toFormat('d LLL'), a: x.total, b: x.answered })), ['Calls', 'Connected']);
  r.section('Call outcomes');
  r.bars(a.callOutcomes.map((o: any, i: number) => ({ label: o.name, value: o.value, color: [COLORS.signal, COLORS.hot, COLORS.cold, COLORS.danger][i] })));
  r.section('What prospects want', 'Latest outcome per lead');
  const oc = await Lead.aggregate([{ $match: { businessId: req.tenant!.businessId } }, { $group: { _id: '$outcome', n: { $sum: 1 } } }]);
  r.bars(Object.keys(OUTCOME_LABEL).filter((k) => k !== 'none').map((k) => ({ label: OUTCOME_LABEL[k], value: oc.find((x) => x._id === k)?.n ?? 0, color: OUTCOME_COLOR[k] ?? COLORS.cold })));
  r.section('Pipeline');
  r.bars(a.funnel.map((f: any) => ({ label: clean(f.stage.replace('_', ' ')).replace(/^./, (c: string) => c.toUpperCase()), value: f.count, color: f.stage === 'lost' ? COLORS.danger : f.stage === 'converted' ? COLORS.hot : COLORS.signal })));
  r.section('Campaign performance');
  r.table([
    { key: 'name', label: 'Campaign', width: 34 }, { key: 'calls', label: 'Calls', width: 10, align: 'right' }, { key: 'answered', label: 'Connected', width: 12, align: 'right' },
    { key: 'rate', label: 'Connect %', width: 12, align: 'right' }, { key: 'interested', label: 'Interested', width: 12, align: 'right' }, { key: 'meetings', label: 'Bookings', width: 11, align: 'right' }, { key: 'avg', label: 'Avg call', width: 10, align: 'right' },
  ], a.campaigns.map((c: any) => ({ ...c, name: clean(c.name), rate: `${c.connectRate}%`, avg: dur(c.avgDuration) })), 'No campaign calls in this period.');
  r.section('AI agent performance');
  r.table([
    { key: 'name', label: 'Agent', width: 26 }, { key: 'calls', label: 'Calls', width: 12, align: 'right' }, { key: 'answered', label: 'Conversations', width: 16, align: 'right' },
    { key: 'rate', label: 'Interest %', width: 14, align: 'right' }, { key: 'meetings', label: 'Bookings', width: 12, align: 'right' }, { key: 'avg', label: 'Avg call', width: 12, align: 'right' },
  ], a.agents.map((x: any) => ({ ...x, name: clean(x.name), rate: `${x.interestRate}%`, avg: dur(x.avgDuration) })), 'No agent calls in this period.');
  await audit(req, 'report.analytics', 'Report');
  await send(res, r, `sales-report-${DateTime.fromJSDate(to).toFormat('yyyy-LL-dd')}.pdf`);
});

reportsRouter.get('/campaigns/:id.pdf', async (req, res) => {
  const c = await Campaign.findOne({ ...scope(req), _id: req.params.id }).populate(tp('agentId', 'name')).lean();
  if (!c) throw notFound('Campaign');
  const b = await Business.findById(req.tenant!.businessId, { name: 1, compliance: 1 }).lean();
  const cls = await CampaignLead.find({ ...scope(req), campaignId: c._id }).populate(tp('leadId', 'companyName contactName phoneMasked outcome outcomeNote followUpAt location score temperature')).lean();
  const calls = await Call.find({ ...scope(req), campaignId: c._id }, { result: 1, durationSec: 1, appointmentId: 1, 'qualification.interested': 1 }).lean();
  const answered = calls.filter((x) => x.result === 'answered');
  const r = new Report(clean(c.name), `Campaign report · ${clean(c.status)} · agent ${clean((c.agentId as any)?.name ?? '')}`, clean(brandName(b)));
  r.kpis([
    { label: 'Leads in campaign', value: cls.length },
    { label: 'Calls placed', value: calls.length },
    { label: 'Connected', value: answered.length, sub: calls.length ? `${Math.round((answered.length / calls.length) * 100)}%` : undefined },
    { label: 'Bookings', value: calls.filter((x) => x.appointmentId).length, accent: true },
  ]);
  if (c.research?.enabled) r.paragraph(`Automatic research: ${clean([...(c.research.keywords ?? []), ...(c.research.locations ?? [])].join(', '))} · ${c.research.frequency} · ${c.research.totalAdded ?? 0} leads added so far${c.endDate ? ` · ends ${d(c.endDate)}` : ''}.`, { color: COLORS.muted, size: 9 });
  r.section('Every lead and what they want');
  const order = ['meeting', 'callback', 'interested', 'nurture', 'busy', 'no_answer', 'none', 'not_interested', 'do_not_call'];
  const rows = cls.filter((x) => x.leadId).map((x: any) => ({ ...x.leadId, cl: x })).sort((a: any, z: any) => order.indexOf(a.outcome ?? 'none') - order.indexOf(z.outcome ?? 'none'));
  r.table([
    { key: 'company', label: 'Company', width: 26 }, { key: 'contact', label: 'Contact', width: 18 }, { key: 'outcome', label: 'What they want', width: 22, color: (x) => OUTCOME_COLOR[x.raw] },
    { key: 'next', label: 'Next step', width: 22 }, { key: 'attempts', label: 'Tries', width: 7, align: 'right' },
  ], rows.map((l: any) => ({
    company: clean(l.companyName), contact: clean(l.contactName ?? '-'), raw: l.outcome, outcome: OUTCOME_LABEL[l.outcome ?? 'none'],
    next: clean(l.followUpAt ? `${l.outcomeNote ?? ''} (${d(l.followUpAt, leadTimezone(l, b?.compliance?.timezone ?? 'UTC'))})` : l.outcomeNote ?? (l.cl.skipReason ? `Skipped: ${l.cl.skipReason}` : '-')), attempts: l.cl.attempts,
  })));
  await send(res, r, `campaign-${clean(c.name).replace(/\W+/g, '-').toLowerCase()}.pdf`);
});

reportsRouter.get('/leads.pdf', async (req, res) => {
  const q = req.query as Record<string, string>;
  const f: any = { ...scope(req) };
  if (q.outcome) f.outcome = { $in: q.outcome.split(',') };
  if (q.approval) f.approval = q.approval;
  if (q.temperature) f.temperature = { $in: q.temperature.split(',') };
  const b = await Business.findById(req.tenant!.businessId, { name: 1, compliance: 1 }).lean();
  const leads = await Lead.find(f).sort({ score: -1 }).limit(2000);
  const title = q.outcome ? `Leads: ${q.outcome.split(',').map((o) => OUTCOME_LABEL[o] ?? o).join(', ')}` : 'Leads report';
  const r = new Report(title, `${leads.length} leads · ${DateTime.now().toFormat('d LLL yyyy')}`, clean(brandName(b)));
  r.table([
    { key: 'company', label: 'Company', width: 22 }, { key: 'contact', label: 'Contact', width: 17 }, { key: 'phone', label: 'Phone', width: 14 },
    { key: 'where', label: 'Location', width: 13 }, { key: 'score', label: 'Fit', width: 6, align: 'right' },
    { key: 'outcome', label: 'What they want', width: 16, color: (x) => OUTCOME_COLOR[x.raw] }, { key: 'next', label: 'Next step', width: 18 },
  ], leads.map((l: any) => ({
    company: clean(l.companyName), contact: clean([l.contactName, l.designation].filter(Boolean).join(', ') || '-'), phone: l.phoneMasked ?? '-',
    where: clean([l.location?.city, l.location?.country].filter(Boolean).join(', ') || '-'), score: l.score, raw: l.outcome,
    outcome: OUTCOME_LABEL[l.outcome ?? 'none'], next: clean(l.followUpAt ? d(l.followUpAt, leadTimezone(l, b?.compliance?.timezone ?? 'UTC')) : l.outcomeNote ?? '-'),
  })));
  await audit(req, 'report.leads', 'Report', undefined, { count: leads.length });
  await send(res, r, 'leads-report.pdf');
});

reportsRouter.get('/follow-ups.pdf', async (req, res) => {
  const b = await Business.findById(req.tenant!.businessId, { name: 1, compliance: 1 }).lean();
  const leads = await Lead.find({ ...scope(req), outcome: { $in: ['meeting', 'callback', 'nurture', 'interested'] } }).sort({ followUpAt: 1 }).limit(2000);
  const r = new Report('Follow-up schedule', 'Meetings, callbacks and "not now" prospects, in date order', clean(brandName(b)));
  r.table([
    { key: 'when', label: 'When (their local time)', width: 22 }, { key: 'company', label: 'Company', width: 22 }, { key: 'contact', label: 'Contact', width: 18 },
    { key: 'outcome', label: 'Type', width: 16, color: (x) => OUTCOME_COLOR[x.raw] }, { key: 'note', label: 'Note', width: 26 },
  ], leads.map((l: any) => ({
    when: d(l.followUpAt, leadTimezone(l, b?.compliance?.timezone ?? 'UTC')), company: clean(l.companyName), contact: clean(l.contactName ?? '-'),
    raw: l.outcome, outcome: OUTCOME_LABEL[l.outcome], note: clean(l.outcomeNote ?? '-'),
  })), 'Nothing scheduled.');
  await send(res, r, 'follow-ups.pdf');
});

reportsRouter.get('/calls/:id.pdf', async (req, res) => {
  const c = await Call.findOne({ ...scope(req), _id: req.params.id }).populate(tp('leadId', 'companyName contactName designation phoneMasked location')).populate(tp('agentId', 'name')).populate(tp('campaignId', 'name')).lean();
  if (!c) throw notFound('Call');
  const b = await Business.findById(req.tenant!.businessId, { name: 1 }).lean();
  const t = c.transcriptId ? await CallTranscript.findOne({ ...scope(req), _id: c.transcriptId }).lean() : null;
  const lead: any = c.leadId ?? {};
  const r = new Report(`Call with ${clean(lead.companyName ?? 'lead')}`, `${d(c.createdAt)} · ${dur(c.durationSec)} · ${clean(c.result ?? c.status)}`, clean(brandName(b)));
  r.kpis([
    { label: 'Contact', value: clean(lead.contactName ?? '-'), sub: clean(lead.designation ?? '') },
    { label: 'Outcome', value: clean(c.result ?? '-'), sub: c.optOut ? 'Opted out' : undefined },
    { label: 'Buying intent', value: clean(c.qualification?.intent ?? '-') },
    { label: 'Sentiment', value: clean(c.sentiment?.label ?? '-') },
  ]);
  r.section('AI summary'); r.paragraph(clean(c.summary ?? 'No summary.'));
  if (c.nextAction) { r.section('Next best action'); r.paragraph(clean(c.nextAction)); }
  if (c.qualification?.requirements?.length) { r.section('Requirements mentioned'); c.qualification.requirements.forEach((q: string) => r.paragraph(`- ${clean(q)}`)); }
  r.section('Transcript');
  r.table([{ key: 'time', label: 'Time', width: 10 }, { key: 'who', label: 'Speaker', width: 14 }, { key: 'text', label: 'What was said', width: 76 }],
    (t?.segments ?? []).map((s: any) => ({ time: dur(s.start), who: s.speaker === 'agent' ? clean((c.agentId as any)?.name ?? 'Agent') : 'Prospect', text: clean(s.text) })), 'No transcript for this call.');
  await audit(req, 'report.call', 'Call', c._id);
  await send(res, r, `call-${String(c._id).slice(-6)}.pdf`);
});
