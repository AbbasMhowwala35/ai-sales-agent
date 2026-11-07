import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Business, Appointment } from '../models/index.js';
import { env } from '../config/env.js';
import { requireAuth, scope } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { badRequest } from '../lib/errors.js';
import { googleAuthUrl, googleConfigured, googleExchangeCode, listCalendarEvents, calendarConnected, googleRedirectUri } from '../providers/calendar/index.js';
import { audit } from '../services/audit.js';
import { logger } from '../lib/logger.js';
import { tp } from '../lib/tenant.js';
import { parse } from '../lib/validate.js';

export const integrationsRouter = Router();
const appUrl = () => (env.CLIENT_ORIGIN.split(',')[0] || env.PUBLIC_BASE_URL).replace(/\/$/, '');

integrationsRouter.get('/google/status', requireAuth, async (req, res) => {
  const b = await Business.findById(req.tenant!.businessId, { googleCalendar: 1 }).lean();
  res.json({ configured: googleConfigured(), connected: calendarConnected(b), email: b?.googleCalendar?.email, connectedAt: b?.googleCalendar?.connectedAt, redirectUri: googleRedirectUri() });
});

integrationsRouter.post('/google/connect', requireAuth, requirePermission('business:write'), async (req, res) => {
  if (!googleConfigured()) throw badRequest('Google sign-in isn’t set up on the server yet. Add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET (see README → Google Calendar).');
  const state = jwt.sign({ b: String(req.tenant!.businessId), u: req.auth!.userId, typ: 'gcal' }, env.JWT_SECRET, { expiresIn: '10m' });
  res.json({ url: googleAuthUrl(state) });
});

/** OAuth redirect target (public — authenticated by the signed `state`). */
integrationsRouter.get('/google/callback', async (req, res) => {
  const back = (q: string) => res.redirect(`${appUrl()}/calendar?${q}`);
  try {
    if (req.query.error) return back(`google=denied`);
    const st = jwt.verify(String(req.query.state ?? ''), env.JWT_SECRET) as any;
    if (st.typ !== 'gcal') throw new Error('bad state');
    const { refreshToken, email } = await googleExchangeCode(String(req.query.code ?? ''));
    if (!refreshToken) return back('google=no_refresh_token');
    await Business.updateOne({ _id: st.b }, { googleCalendar: { email, refreshToken: (await import('../lib/crypto.js')).encrypt(refreshToken), calendarId: 'primary', connectedAt: new Date(), connectedBy: st.u } });
    await audit(null, 'integration.google_connected', 'Business', st.b, { email }, st.b);
    back('google=connected');
  } catch (e: any) {
    logger.warn({ err: e.message }, 'google oauth callback failed');
    back('google=error');
  }
});

integrationsRouter.delete('/google', requireAuth, requirePermission('business:write'), async (req, res) => {
  await Business.updateOne({ _id: req.tenant!.businessId }, { $unset: { googleCalendar: 1 } });
  await audit(req, 'integration.google_disconnected', 'Business', req.tenant!.businessId);
  res.status(204).end();
});

/** Calendar view: meetings the agent booked (with who/what) + the owner’s real Google Calendar events. */
integrationsRouter.get('/calendar/events', requireAuth, async (req, res) => {
  const q = parse(z.object({ from: z.coerce.date(), to: z.coerce.date() }), req.query);
  if (q.to.getTime() - q.from.getTime() > 92 * 86400_000) throw badRequest('Choose a range of up to 3 months');
  const [b, appts] = await Promise.all([
    Business.findById(req.tenant!.businessId).lean(),
    Appointment.find({ ...scope(req), startsAt: { $gte: q.from, $lte: q.to } }).sort({ startsAt: 1 }).populate(tp('leadId', 'companyName contactName designation phoneMasked email location outcome brief category')).lean(),
  ]);
  let google: any[] | null = null; let googleError: string | undefined;
  try { google = await listCalendarEvents(b, q.from, q.to); } catch (e: any) { googleError = 'Couldn’t read your Google Calendar — try reconnecting it.'; logger.warn({ err: e.message }, 'list google events failed'); }
  const ours = new Set(appts.map((a: any) => String(a._id)));
  res.json({
    connected: calendarConnected(b), googleEmail: b?.googleCalendar?.email, googleError,
    appointments: appts,
    googleEvents: (google ?? []).filter((e) => !e.appointmentId || !ours.has(e.appointmentId)),
  });
});
