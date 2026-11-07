import { tp } from '../lib/tenant.js';
import { Router } from 'express';
import { z } from 'zod';
import { Call, CallTranscript, CallRecording, Lead, Appointment } from '../models/index.js';
import { scope, signMediaToken, verifyMediaToken } from '../middleware/auth.js';
import { requirePermission, can } from '../middleware/rbac.js';
import { parse, pageParams } from '../lib/validate.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { escapeRegex } from '../lib/sanitize.js';
import { createAndQueueCall, finalizeCall } from '../services/calls/lifecycle.js';
import { getTelephony } from '../providers/telephony/index.js';
import { storage } from '../providers/storage/index.js';
import { audit } from '../services/audit.js';
import { TeamMember } from '../models/index.js';

export const callsRouter = Router();
export const mediaRouter = Router(); // token-authenticated (for <audio src>)

callsRouter.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { page, limit, skip } = pageParams(q);
  const f: any = { ...scope(req), direction: { $ne: 'test' } };
  if (q.result) f.result = { $in: q.result.split(',') };
  if (q.status) f.status = q.status;
  if (q.campaignId && /^[a-f0-9]{24}$/i.test(q.campaignId)) f.campaignId = q.campaignId;
  if (q.leadId && /^[a-f0-9]{24}$/i.test(q.leadId)) f.leadId = q.leadId;
  if (q.sentiment) f['sentiment.label'] = q.sentiment;
  if (q.hasRecording === 'true') f.recordingId = { $exists: true };
  if (q.from || q.to) { f.createdAt = {}; if (q.from) f.createdAt.$gte = new Date(q.from); if (q.to) f.createdAt.$lte = new Date(q.to); }
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search.slice(0, 100)), 'i');
    const leadIds = (await Lead.find({ ...scope(req), $or: [{ companyName: rx }, { contactName: rx }] }, { _id: 1 }).limit(500).lean()).map((l) => l._id);
    const tIds = (await CallTranscript.find({ ...scope(req), $text: { $search: q.search.slice(0, 100) } }, { callId: 1 }).limit(500).lean()).map((t) => t.callId);
    f.$or = [{ leadId: { $in: leadIds } }, { _id: { $in: tIds } }];
  }
  const [items, total] = await Promise.all([
    Call.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(tp('leadId', 'companyName contactName designation phoneMasked')).populate(tp('campaignId', 'name')).populate(tp('agentId', 'name')).populate(tp('recordingId', 'status durationSec')),
    Call.countDocuments(f),
  ]);
  res.json({ items: items.map((c) => { const j: any = c.toJSON(); delete j.toNumber; return j; }), total, page, limit });
});

callsRouter.get('/appointments', async (req, res) => {
  const upcoming = req.query.upcoming !== 'false';
  const f: any = { ...scope(req) };
  if (upcoming) { f.startsAt = { $gte: new Date(Date.now() - 3600_000) }; f.status = 'scheduled'; }
  res.json({ items: await Appointment.find(f).sort({ startsAt: upcoming ? 1 : -1 }).limit(100).populate(tp('leadId', 'companyName contactName')).lean() });
});

callsRouter.patch('/appointments/:id', requirePermission('leads:write'), async (req, res) => {
  const body = parse(z.object({ status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).optional(), startsAt: z.coerce.date().optional(), notes: z.string().max(2000).optional() }), req.body);
  const a = await Appointment.findOneAndUpdate({ ...scope(req), _id: req.params.id }, body, { returnDocument: 'after' });
  if (!a) throw notFound('Appointment');
  if (body.status === 'completed') await Lead.updateOne({ ...scope(req), _id: a.leadId, status: 'meeting_scheduled' }, { status: 'meeting_scheduled' });
  res.json(a);
});

callsRouter.get('/:id', async (req, res) => {
  const call = await Call.findOne({ ...scope(req), _id: req.params.id }).populate(tp('leadId')).populate(tp('campaignId', 'name')).populate(tp('agentId', 'name voice')).populate(tp('appointmentId'));
  if (!call) throw notFound('Call');
  const [transcript, recording] = await Promise.all([
    call.transcriptId ? CallTranscript.findOne({ ...scope(req), _id: call.transcriptId }).lean() : null,
    call.recordingId ? CallRecording.findOne({ ...scope(req), _id: call.recordingId }, { providerUrl: 0 }).lean() : null,
  ]);
  const j: any = call.toJSON(); delete j.toNumber;
  const role = req.auth!.role;
  res.json({
    ...j, transcript,
    recording: recording ? { ...recording, canListen: can(role, 'recordings:listen'), canDownload: can(role, 'recordings:download') } : null,
  });
});

/** Issue a short-lived signed URL for the recording (headers can't be attached to <audio>). */
callsRouter.post('/:id/recording-url', requirePermission('recordings:listen'), async (req, res) => {
  const { download } = parse(z.object({ download: z.boolean().default(false) }), req.body ?? {});
  if (download && !can(req.auth!.role, 'recordings:download')) throw forbidden('You are not allowed to download recordings');
  const call = await Call.findOne({ ...scope(req), _id: req.params.id }, { recordingId: 1 }).lean();
  if (!call?.recordingId) throw notFound('Recording');
  const rec = await CallRecording.findOne({ ...scope(req), _id: call.recordingId }).lean();
  if (!rec || rec.status !== 'available') throw badRequest('Recording is still processing');
  const token = signMediaToken({ userId: req.auth!.userId, businessId: String(req.tenant!.businessId), callId: String(call._id), action: download ? 'download' : 'listen' });
  await audit(req, download ? 'recording.download' : 'recording.listen', 'Call', call._id);
  res.json({ url: `/api/media/recordings/${call._id}?token=${token}`, expiresIn: 900 });
});

mediaRouter.get('/recordings/:callId', async (req, res) => {
  const p = verifyMediaToken(String(req.query.token ?? ''));
  if (p.callId !== req.params.callId) throw forbidden();
  const member = await TeamMember.findOne({ businessId: p.businessId, userId: p.userId, status: 'active' }).lean();
  if (!member || !can(member.role as any, p.action === 'download' ? 'recordings:download' : 'recordings:listen')) throw forbidden();
  const call = await Call.findOne({ businessId: p.businessId, _id: p.callId }, { recordingId: 1 }).lean();
  const rec = call?.recordingId ? await CallRecording.findOne({ businessId: p.businessId, _id: call.recordingId }).lean() : null;
  if (!rec?.storageKey || !storage.exists(rec.storageKey)) throw notFound('Recording');
  const size = storage.stat(rec.storageKey).size;
  res.setHeader('content-type', rec.mimeType ?? 'audio/mpeg');
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('cache-control', 'private, no-store');
  if (p.action === 'download') res.setHeader('content-disposition', `attachment; filename="call-${p.callId}.${rec.storageKey.split('.').pop()}"`);
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? parseInt(range[1], 10) : 0;
    const end = range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1;
    if (start >= size || start > end) { res.status(416).setHeader('content-range', `bytes */${size}`); return res.end(); }
    res.status(206).setHeader('content-range', `bytes ${start}-${end}/${size}`);
    res.setHeader('content-length', end - start + 1);
    return storage.stream(rec.storageKey, { start, end }).pipe(res);
  }
  res.setHeader('content-length', size);
  storage.stream(rec.storageKey).pipe(res);
});

/** Manual "Call now" for a single approved lead. */
callsRouter.post('/', requirePermission('calls:write'), async (req, res) => {
  const body = parse(z.object({ leadId: z.string().regex(/^[a-f0-9]{24}$/i), agentId: z.string().regex(/^[a-f0-9]{24}$/i).optional() }), req.body);
  const { call, check } = await createAndQueueCall({ businessId: req.tenant!.businessId, leadId: body.leadId, agentId: body.agentId });
  if (!call) throw badRequest(`Call blocked: ${check.reason}`, { reason: check.reason });
  await audit(req, 'call.manual', 'Call', call._id, { leadId: body.leadId });
  res.status(202).json(call.toJSON());
});

callsRouter.post('/:id/hangup', requirePermission('calls:write'), async (req, res) => {
  const call = await Call.findOne({ ...scope(req), _id: req.params.id });
  if (!call) throw notFound('Call');
  if (call.status === 'ended') return res.json(call.toJSON());
  if (call.providerCallId) await getTelephony().hangup?.(call.providerCallId).catch(() => undefined);
  await finalizeCall(String(call._id), String(req.tenant!.businessId), { result: call.answeredAt ? 'answered' : 'failed', endReason: `Ended manually by ${req.auth!.name}` });
  res.json({ ok: true });
});
