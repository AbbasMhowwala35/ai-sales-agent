import { env } from '../../config/env.js';
import { fetchWithRetry, jsonOrThrow } from '../http.js';

export interface CalendarEvent { title: string; description?: string; startsAt: Date; endsAt: Date; attendeeEmail?: string; timezone?: string; appointmentId?: string }

const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** RFC 5545 iCalendar invite — works with Google, Outlook and Apple calendars as an email attachment. */
export function buildIcs(ev: CalendarEvent & { uid: string; location?: string }) {
  const esc = (s = '') => s.replace(/[,;\\]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dialstack//EN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    `UID:${ev.uid}`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(ev.startsAt)}`, `DTEND:${fmt(ev.endsAt)}`,
    `SUMMARY:${esc(ev.title)}`, `DESCRIPTION:${esc(ev.description)}`, ev.location ? `LOCATION:${esc(ev.location)}` : '',
    ev.attendeeEmail ? `ATTENDEE;RSVP=TRUE:mailto:${ev.attendeeEmail}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

/* ------------------------------ Google OAuth ------------------------------ */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly', 'openid', 'email'];
export const googleConfigured = () => !!(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET);
export const googleRedirectUri = () => `${env.PUBLIC_BASE_URL}/api/integrations/google/callback`;

export function googleAuthUrl(state: string) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CALENDAR_CLIENT_ID!, redirect_uri: googleRedirectUri(), response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function googleExchangeCode(code: string) {
  const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CALENDAR_CLIENT_ID!, client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET!, redirect_uri: googleRedirectUri(), grant_type: 'authorization_code' }),
  });
  const tok = await jsonOrThrow(res, 'Google OAuth');
  let email: string | undefined;
  try { email = JSON.parse(Buffer.from(String(tok.id_token).split('.')[1], 'base64url').toString()).email; } catch { /* */ }
  return { refreshToken: tok.refresh_token as string | undefined, email };
}

async function accessToken(refreshToken: string) {
  const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CALENDAR_CLIENT_ID ?? '', client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET ?? '', refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  return (await jsonOrThrow(res, 'Google OAuth')).access_token as string;
}

/** The business’s connected Google account, falling back to a server-wide refresh token if one is configured. */
function credentials(business: any): { refreshToken: string; calendarId: string } | null {
  const g = business?.googleCalendar;
  if (g?.refreshToken && googleConfigured()) return { refreshToken: g.refreshToken, calendarId: g.calendarId || 'primary' };
  if (env.GOOGLE_CALENDAR_REFRESH_TOKEN && googleConfigured()) return { refreshToken: env.GOOGLE_CALENDAR_REFRESH_TOKEN, calendarId: env.GOOGLE_CALENDAR_ID };
  return null;
}
export const calendarConnected = (business: any) => !!credentials(business);

/** Create the event on the owner’s Google Calendar with a Google Meet link, inviting the prospect. */
export async function createCalendarEvent(business: any, ev: CalendarEvent): Promise<{ id: string; meetLink?: string; htmlLink?: string } | null> {
  const cred = credentials(business);
  if (!cred) return null;
  const token = await accessToken(cred.refreshToken);
  const res = await fetchWithRetry(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cred.calendarId)}/events?sendUpdates=all&conferenceDataVersion=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      summary: ev.title, description: ev.description,
      start: { dateTime: ev.startsAt.toISOString(), timeZone: ev.timezone }, end: { dateTime: ev.endsAt.toISOString(), timeZone: ev.timezone },
      attendees: ev.attendeeEmail ? [{ email: ev.attendeeEmail }] : [],
      conferenceData: { createRequest: { requestId: `ds-${ev.appointmentId ?? Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      extendedProperties: { private: { dialstackAppointmentId: ev.appointmentId ?? '' } },
      reminders: { useDefault: true },
    }),
  });
  const data = await jsonOrThrow(res, 'Google Calendar');
  const meet = data.hangoutLink ?? data.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri;
  return { id: data.id, meetLink: meet, htmlLink: data.htmlLink };
}

/** Read the owner’s real calendar for the calendar view. */
export async function listCalendarEvents(business: any, from: Date, to: Date) {
  const cred = credentials(business);
  if (!cred) return null;
  const token = await accessToken(cred.refreshToken);
  const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const res = await fetchWithRetry(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cred.calendarId)}/events?${q}`, { headers: { authorization: `Bearer ${token}` } });
  const data = await jsonOrThrow(res, 'Google Calendar');
  return (data.items ?? []).map((e: any) => ({
    id: e.id, title: e.summary ?? '(busy)', startsAt: e.start?.dateTime ?? e.start?.date, endsAt: e.end?.dateTime ?? e.end?.date, allDay: !e.start?.dateTime,
    meetLink: e.hangoutLink, htmlLink: e.htmlLink, appointmentId: e.extendedProperties?.private?.dialstackAppointmentId || undefined,
    attendees: (e.attendees ?? []).map((a: any) => a.email),
  }));
}
