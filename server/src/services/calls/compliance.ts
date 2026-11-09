import { DateTime } from 'luxon';
import { DncEntry, Call } from '../../models/index.js';
import { blindIndex } from '../../lib/crypto.js';
import { phoneCountry } from '../../lib/phone.js';
import { env } from '../../config/env.js';
import { clock } from '../../lib/clock.js';

const COUNTRY_TZ: Record<string, string> = {
  IN: 'Asia/Kolkata', AE: 'Asia/Dubai', SG: 'Asia/Singapore', GB: 'Europe/London', DE: 'Europe/Berlin', FR: 'Europe/Paris',
  AU: 'Australia/Sydney', CA: 'America/Toronto', US: 'America/New_York', SA: 'Asia/Riyadh', NP: 'Asia/Kathmandu', BD: 'Asia/Dhaka', LK: 'Asia/Colombo',
};

/** Statutory hard limits applied on top of business-configured windows (local time of the callee). */
const LEGAL_WINDOWS: Record<string, { start: number; end: number }> = {
  IN: { start: 9, end: 21 },  // TRAI TCCCPR: commercial calls only 09:00–21:00
  US: { start: 8, end: 21 },  // TCPA: 8 AM – 9 PM local (some states stricter — business window narrows further)
  CA: { start: 9, end: 21.5 }, // CRTC
  GB: { start: 8, end: 21 },  // Ofcom / industry guidance
  AU: { start: 9, end: 20 },  // Do Not Call Register (Telemarketing) Industry Standard, weekdays
  DEFAULT: { start: 9, end: 20 },
};

/** US / Canada / Australia states → IANA zone (by state name or postal code). */
const REGION_TZ: Record<string, string> = {
  // US Eastern
  ...Object.fromEntries(['CT','DE','FL','GA','ME','MD','MA','NH','NJ','NY','NC','OH','PA','RI','SC','VT','VA','WV','DC','MI','IN','KY','connecticut','delaware','florida','georgia','maine','maryland','massachusetts','new hampshire','new jersey','new york','north carolina','ohio','pennsylvania','rhode island','south carolina','vermont','virginia','west virginia','district of columbia','michigan','indiana','kentucky'].map((k) => [k.toLowerCase(), 'America/New_York'])),
  ...Object.fromEntries(['AL','AR','IL','IA','LA','MN','MS','MO','OK','WI','TX','KS','NE','SD','ND','TN','alabama','arkansas','illinois','iowa','louisiana','minnesota','mississippi','missouri','oklahoma','wisconsin','texas','kansas','nebraska','south dakota','north dakota','tennessee'].map((k) => [k.toLowerCase(), 'America/Chicago'])),
  ...Object.fromEntries(['CO','MT','NM','UT','WY','ID','colorado','montana','new mexico','utah','wyoming','idaho'].map((k) => [k.toLowerCase(), 'America/Denver'])),
  az: 'America/Phoenix', arizona: 'America/Phoenix',
  ...Object.fromEntries(['CA','NV','OR','WA','california','nevada','oregon','washington'].map((k) => [k.toLowerCase(), 'America/Los_Angeles'])),
  ak: 'America/Anchorage', alaska: 'America/Anchorage', hi: 'Pacific/Honolulu', hawaii: 'Pacific/Honolulu',
  // Canada
  on: 'America/Toronto', ontario: 'America/Toronto', qc: 'America/Toronto', quebec: 'America/Toronto', bc: 'America/Vancouver', 'british columbia': 'America/Vancouver', ab: 'America/Edmonton', alberta: 'America/Edmonton', mb: 'America/Winnipeg', manitoba: 'America/Winnipeg', ns: 'America/Halifax', 'nova scotia': 'America/Halifax',
  // Australia
  nsw: 'Australia/Sydney', 'new south wales': 'Australia/Sydney', vic: 'Australia/Melbourne', victoria: 'Australia/Melbourne', qld: 'Australia/Brisbane', queensland: 'Australia/Brisbane', wa: 'Australia/Perth', 'western australia': 'Australia/Perth', sa: 'Australia/Adelaide', 'south australia': 'Australia/Adelaide',
};
const COUNTRY_NAMES: Record<string, string> = { 'united states': 'US', usa: 'US', us: 'US', america: 'US', 'united kingdom': 'GB', uk: 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'great britain': 'GB', canada: 'CA', australia: 'AU', india: 'IN', 'united arab emirates': 'AE', uae: 'AE', singapore: 'SG', ireland: 'IE', 'new zealand': 'NZ', germany: 'DE', france: 'FR', 'saudi arabia': 'SA' };
Object.assign(COUNTRY_TZ, { IE: 'Europe/Dublin', NZ: 'Pacific/Auckland' });

export function countryCode(name?: string) { if (!name) return undefined; const k = name.trim().toLowerCase(); return COUNTRY_NAMES[k] ?? (k.length === 2 ? k.toUpperCase() : undefined); }

/** Country used for legal rules & caller ID: the dialled number’s country, else the lead’s location. */
export function leadCountry(lead: any): string | undefined {
  if ((lead?.tags ?? []).includes('sandbox')) return countryCode(lead?.location?.country) ?? phoneCountry(lead?.phone);
  return phoneCountry(lead?.phone) ?? countryCode(lead?.location?.country);
}

export function leadTimezone(lead: any, fallback: string) {
  if (lead?.timezone) return lead.timezone;
  const region = (lead?.location?.state ?? '').trim().toLowerCase();
  const c = leadCountry(lead);
  if (region && REGION_TZ[region] && ['US', 'CA', 'AU'].includes(c ?? '')) return REGION_TZ[region];
  return (c && COUNTRY_TZ[c]) || fallback;
}

/** Local-presence caller ID: pick the business number registered for the prospect’s country. */
export function resolveCallerId(business: any, lead: any): { number?: string; vapiPhoneNumberId?: string; country?: string; missing?: boolean } {
  const country = leadCountry(lead);
  const ids: any[] = business?.callerIds ?? [];
  if (!ids.length) return { country, number: (env.TELEPHONY_PROVIDER === 'telnyx' ? env.TELNYX_FROM_NUMBER : env.TWILIO_FROM_NUMBER), vapiPhoneNumberId: env.VAPI_PHONE_NUMBER_ID };
  const hit = ids.find((x) => x.country?.toUpperCase() === country) ?? (country === 'CA' ? ids.find((x) => x.country?.toUpperCase() === 'US') : undefined);
  return hit ? { country, number: hit.number, vapiPhoneNumberId: hit.vapiPhoneNumberId } : { country, missing: true };
}

const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h + (m || 0) / 60; };

export function withinWindow(now: Date, zone: string, days: number[], start: string, end: string) {
  const dt = DateTime.fromJSDate(now).setZone(zone);
  const day = dt.weekday % 7; // luxon: 1=Mon..7=Sun → 0=Sun
  const h = dt.hour + dt.minute / 60;
  return days.includes(day) && h >= hm(start) && h < hm(end);
}

const sandboxLeadCheck = (lead: any) => (lead.tags ?? []).includes('sandbox');

export interface ComplianceCheck { ok: boolean; reason?: string; retryable?: boolean }

/** Gatekeeper evaluated immediately before every outbound dial. */
export async function canCall(lead: any, business: any, campaign: any | null, opts: { now?: Date; provider?: string; ignoreWindow?: boolean } = {}): Promise<ComplianceCheck> {
  const now = opts.now ?? clock.now();
  const c = business.compliance ?? {};
  if (!lead.phone) return { ok: false, reason: 'Lead has no valid phone number' };
  if (lead.doNotCall || lead.consent === 'revoked') return { ok: false, reason: 'Lead opted out / is on the Do-Not-Call list' };
  if (lead.approval !== 'approved') return { ok: false, reason: 'Lead has not been approved for outreach' };
  if (await DncEntry.exists({ businessId: business._id, phoneHash: blindIndex(lead.phone) })) return { ok: false, reason: 'Number is on the Do-Not-Call list' };
  if (sandboxLeadCheck(lead) && (opts.provider ?? env.TELEPHONY_PROVIDER) !== 'simulator') return { ok: false, reason: 'Sandbox (fictional) leads can only be called with the simulator provider' };

  // Every window is evaluated in the PROSPECT’s local time.
  const zone = leadTimezone(lead, c.timezone ?? 'Asia/Kolkata');
  const callerId = resolveCallerId(business, lead);
  if (callerId.missing && (opts.provider ?? env.TELEPHONY_PROVIDER) !== 'simulator') return { ok: false, reason: `No local caller ID for ${callerId.country ?? 'this country'} — add one under Settings → Calling & compliance` };
  if (!opts.ignoreWindow) {
    const country = leadCountry(lead) ?? 'DEFAULT';
    const legal = LEGAL_WINDOWS[country] ?? LEGAL_WINDOWS.DEFAULT;
    const local = DateTime.fromJSDate(now).setZone(zone);
    const h = local.hour + local.minute / 60;
    if (h < legal.start || h >= legal.end) return { ok: false, reason: `Outside legal calling hours in ${country} (${local.toFormat('HH:mm')} local)`, retryable: true };
    if (!withinWindow(now, zone, c.callingDays ?? [1, 2, 3, 4, 5, 6], c.callingWindowStart ?? '10:00', c.callingWindowEnd ?? '19:00'))
      return { ok: false, reason: `Outside calling hours in the prospect’s time zone (${local.toFormat('ccc HH:mm')} ${zone})`, retryable: true };
    if (country === 'AU' && local.weekday === 7) return { ok: false, reason: 'No telemarketing calls on Sundays in Australia', retryable: true };
    if (campaign) {
      const s = campaign.schedule ?? {};
      if (!withinWindow(now, zone, s.days ?? [1, 2, 3, 4, 5], s.startTime ?? '10:00', s.endTime ?? '18:00'))
        return { ok: false, reason: 'Outside the campaign schedule', retryable: true };
    }
  }
  // Hard cap on attempts to the same lead across all campaigns in a rolling 7 days
  const since = new Date(now.getTime() - 7 * 86400_000);
  const recent = await Call.countDocuments({ businessId: business._id, leadId: lead._id, direction: 'outbound', queuedAt: { $gte: since } });
  if (recent >= (c.maxAttemptsPerLead ?? 3)) return { ok: false, reason: `Reached the maximum of ${c.maxAttemptsPerLead ?? 3} call attempts to this lead in 7 days` };
  const inFlight = await Call.exists({ businessId: business._id, leadId: lead._id, status: { $in: ['queued', 'ringing', 'in_progress'] } });
  if (inFlight) return { ok: false, reason: 'A call to this lead is already in progress', retryable: true };
  return { ok: true };
}
