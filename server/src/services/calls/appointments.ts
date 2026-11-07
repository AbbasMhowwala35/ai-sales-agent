import { Appointment, Lead, TeamMember, Business } from '../../models/index.js';
import { buildIcs, createCalendarEvent } from '../../providers/calendar/index.js';
import { sendEmail } from '../../providers/email/index.js';
import { logActivity } from '../activity.js';
import { notify } from '../notifications.js';
import { formatMeetingTime } from '../agent/nlu.js';
import { logger } from '../../lib/logger.js';

export async function createAppointment(o: { businessId: unknown; leadId: unknown; callId?: unknown; at: Date; kind: 'meeting' | 'callback'; business: any; lead: any; durationMin?: number; userId?: unknown; notes?: string; with?: 'owner' | 'specialist' }) {
  const tz = (await import('./compliance.js')).leadTimezone(o.lead, o.business?.compliance?.timezone ?? 'Asia/Kolkata'); // prospect’s local time
  const endsAt = new Date(o.at.getTime() + (o.durationMin ?? (o.kind === 'callback' ? 15 : 30)) * 60_000);
  const title = o.kind === 'callback' ? `Callback: ${o.lead.companyName}` : `${o.business.name} × ${o.lead.companyName}${o.lead.contactName ? ` (${o.lead.contactName})` : ''}`;
  const appt = await Appointment.create({
    businessId: o.businessId, leadId: o.leadId, callId: o.callId, type: o.kind, title, startsAt: o.at, endsAt, timezone: tz,
    attendeeEmail: o.lead.email, assignedTo: o.lead.assignedTo, notes: o.notes, with: o.with ?? 'specialist',
  });
  const description = `Booked by the AI sales agent.${o.lead.contactName ? `\nContact: ${o.lead.contactName}` : ''}${o.notes ? `\n${o.notes}` : ''}`;
  let meetLink: string | undefined;
  try {
    const biz = o.business?.googleCalendar ? o.business : await Business.findById(o.businessId).lean();
    const ev = await createCalendarEvent(biz, { title, description, startsAt: o.at, endsAt, attendeeEmail: o.kind === 'meeting' ? o.lead.email : undefined, timezone: tz, appointmentId: String(appt._id) });
    if (ev) { meetLink = ev.meetLink; await Appointment.updateOne({ businessId: o.businessId, _id: appt._id }, { calendarEventId: ev.id, meetLink: ev.meetLink }); }
  } catch (e: any) { logger.warn({ err: e.message }, 'calendar sync failed'); }
  const ics = buildIcs({ uid: `${appt._id}@dialstack`, title, description: `${description}${meetLink ? `\nJoin: ${meetLink}` : ''}`, startsAt: o.at, endsAt, attendeeEmail: o.lead.email, location: meetLink });
  const when = formatMeetingTime(o.at, tz);
  if (o.kind === 'meeting' && o.lead.email) {
    await sendEmail({ to: o.lead.email, subject: `Confirmed: ${title} — ${when}`, text: `Hi ${o.lead.contactName ?? ''},\n\nThanks for your time today. Your meeting with ${o.business.name} is confirmed for ${when} (${tz}).${meetLink ? `\n\nJoin on Google Meet: ${meetLink}` : ''}\n\nReply to this email to reschedule.`, attachments: [{ filename: 'invite.ics', content: ics, contentType: 'text/calendar' }] }).catch(() => undefined);
  }
  // internal notification + email to assignee/owners
  const recipients = o.lead.assignedTo ? [o.lead.assignedTo] : (await TeamMember.find({ businessId: o.businessId, role: { $in: ['owner', 'admin', 'manager'] }, status: 'active' }, { userId: 1 }).lean()).map((m) => m.userId);
  for (const userId of recipients) await notify(o.businessId, { userId, type: 'success', title: o.kind === 'callback' ? 'Callback requested' : 'Meeting booked by AI agent', message: `${o.lead.companyName} — ${when}`, link: `/leads/${o.leadId}` });
  if (o.kind === 'meeting') await Lead.updateOne({ businessId: o.businessId, _id: o.leadId }, { status: 'meeting_scheduled', nextFollowUpAt: o.at });
  else await Lead.updateOne({ businessId: o.businessId, _id: o.leadId }, { nextFollowUpAt: o.at });
  await logActivity(o.businessId, o.leadId, 'appointment', `${o.kind === 'callback' ? 'Callback' : 'Meeting'} scheduled for ${when}`, { appointmentId: String(appt._id) }, o.userId);
  return appt;
}
