import { toE164 } from '../../lib/phone.js';
import type { RawLead } from '../../providers/leads/types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LEGAL = /\b(pvt|private|ltd|limited|llp|llc|inc|corp|corporation|co|company|plc|gmbh)\b\.?/g;

export function normalizeCompany(name: string) {
  return name.toLowerCase().replace(/&/g, ' and ').replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function domainOf(url?: string) {
  if (!url) return undefined;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return undefined; }
}

const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'rediffmail.com', 'icloud.com', 'proton.me']);

export function normalizeLead(raw: RawLead, defaultCountry: any = 'IN') {
  const companyName = (raw.companyName ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const email = raw.email && EMAIL_RE.test(raw.email.trim()) ? raw.email.trim().toLowerCase() : undefined;
  const phone = toE164(raw.phone, defaultCountry);
  const website = raw.website?.trim() || undefined;
  let domain = domainOf(website);
  if (!domain && email && !FREE_MAIL.has(email.split('@')[1])) domain = email.split('@')[1];
  const contact = raw.contactName?.replace(/\s+/g, ' ').trim() || undefined;
  return {
    companyName,
    contactName: contact,
    designation: raw.designation?.trim() || undefined,
    email, phone, website, domain,
    location: { address: raw.address, city: raw.city, state: raw.state, country: raw.country },
    industry: raw.industry, companySize: raw.companySize,
    description: raw.description?.slice(0, 2000), sourceRef: raw.sourceRef, category: raw.category?.trim().slice(0, 60) || undefined,
    dedupeKey: `${normalizeCompany(companyName)}|${(contact ?? raw.city ?? '').toLowerCase().replace(/\s+/g, ' ')}`,
  };
}
export type NormalizedLead = ReturnType<typeof normalizeLead>;
