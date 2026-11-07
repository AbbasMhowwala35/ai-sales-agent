import { env } from '../../config/env.js';
import { expandLocation } from '../../lib/geo.js';
import type { LeadProvider, DiscoveryQuery, RawLead } from './types.js';

/**
 * SANDBOX provider — generates realistic *fictional* companies matching the ICP so the full pipeline can be
 * exercised without paid data APIs. Uses reserved fictional phone numbers (+1 xxx-555-01xx) and example.com-style
 * domains. Leads are tagged `sandbox` and the dialer refuses to place real carrier calls to them.
 */
const PREFIX = ['Nova', 'Bright', 'Summit', 'Blue', 'Apex', 'Green', 'Urban', 'Prime', 'Vertex', 'Silver', 'Lotus', 'Indus', 'Coastal', 'Metro', 'Pioneer', 'Zenith', 'Harbor', 'Crest', 'Saffron', 'Orbit'];
const SUFFIX = ['Solutions', 'Labs', 'Group', 'Enterprises', 'Systems', 'Works', 'Partners', 'Studio', 'Industries', 'Ventures', 'Retail', 'Clinic', 'Logistics', 'Foods', 'Realty'];
const FIRST = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Neha', 'Arjun', 'Kavya', 'Rahul', 'Sneha', 'Daniel', 'Sara', 'Imran', 'Meera', 'Karan', 'Zoya'];
const LAST = ['Sharma', 'Patel', 'Iyer', 'Khan', 'Reddy', 'Mehta', 'Nair', 'Gupta', 'Singh', 'Das', 'Joshi', 'Rao'];
const ROLES = ['Founder', 'CEO', 'Operations Head', 'Marketing Manager', 'Purchase Manager', 'Director', 'General Manager', 'IT Head'];
const SIZES = ['1-10', '11-50', '51-200', '201-500'];
const W_FIRST = ['Emily', 'Jessica', 'Ashley', 'Megan', 'Lauren', 'Brittany', 'Olivia', 'Mia', 'Chloe', 'Tyler', 'Jason', 'Marcus', 'Sophie', 'Hannah', 'Grace', 'Daniel'];
const W_LAST = ['Johnson', 'Martinez', 'Brown', 'Davis', 'Garcia', 'Miller', 'Wilson', 'Taylor', 'Anderson', 'Thomas', 'Clarke', 'Hughes', 'Evans', 'Walker'];
const W_ROLES = ['Owner', 'Salon Owner', 'Founder', 'Salon Manager', 'General Manager', 'Director of Operations'];
const STATE: Record<string, string> = { austin: 'TX', dallas: 'TX', houston: 'TX', 'san antonio': 'TX', miami: 'FL', orlando: 'FL', tampa: 'FL', 'los angeles': 'CA', 'san diego': 'CA', 'san francisco': 'CA', 'new york': 'NY', brooklyn: 'NY', chicago: 'IL', phoenix: 'AZ', seattle: 'WA', denver: 'CO', atlanta: 'GA', boston: 'MA' };
const SALON_PRE = ['Luxe', 'Bloom', 'Velvet', 'Golden', 'Willow', 'Aura', 'Rose', 'Ivy', 'Bliss', 'Halo', 'Mane', 'Polished', 'Serene', 'Gloss', 'Studio 9', 'Copper'];
const SALON_SUF = ['Hair Studio', 'Salon & Spa', 'Beauty Bar', 'Hair Co.', 'Nail Lounge', 'Salon', 'Blowout Bar', 'Day Spa', 'Hair Lounge', 'Beauty Collective'];

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];

export const sandbox: LeadProvider = {
  id: 'sandbox',
  label: 'Sandbox (fictional demo data)',
  configured: () => env.ENABLE_SANDBOX_LEADS,
  async discover(q: DiscoveryQuery) {
    const seedStr = JSON.stringify([q.keywords, q.industries, q.locations]) + Date.now().toString().slice(0, -5);
    let seed = 0; for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const r = rng(seed);
    const industries = q.industries.length ? q.industries : ['Retail', 'Healthcare', 'Manufacturing', 'Software', 'Education'];
    const locations = q.locations.length ? q.locations : ['Mumbai, India', 'Bengaluru, India', 'Pune, India'];
    const out: RawLead[] = [];
    for (let i = 0; i < q.limit; i++) {
      const industry = r() < 0.75 ? pick(r, industries) : pick(r, ['Hospitality', 'Construction', 'Logistics', 'Media']);
      const loc = pick(r, locations);
      const parts = loc.split(',').map((s) => s.trim());
      const ex = expandLocation(loc, Math.floor(r() * 1000));
      const city = ex.city;
      let country = ex.country ?? (parts.length > 1 ? parts[parts.length - 1] : 'India');
      const st = ex.region ?? STATE[city.toLowerCase()] ?? (parts.length === 3 ? parts[1] : /^[A-Z]{2}$/.test(country) && country !== 'UK' ? country : undefined);
      if (st && /^[A-Z]{2}$/.test(country) && country !== 'UK') country = 'USA';
      const western = /usa|united states|^us$|uk|united kingdom|england|canada|australia|ireland|new zealand/i.test(country) || (!!st && !/india/i.test(country));
      const uk = /uk|united kingdom|england|scotland|wales|london|manchester/i.test(`${loc} ${country}`);
      const au = /australia/i.test(country);
      const salon = q.keywords.some((k) => /salon|spa|beauty|nail|hair|barber/i.test(k));
      const ngo = q.keywords.some((k) => /ngo|non-?profit|charity|foundation/i.test(k));
      const name = ngo ? `${pick(r, ['Helping', 'Bright Futures', 'Open Door', 'Harbor', 'Hope', 'Common Ground', 'Second Chance', 'Little Steps'])} ${pick(r, ['Foundation', 'Trust', 'Community Project', 'Charity', 'Outreach'])}` : salon ? `${pick(r, SALON_PRE)} ${pick(r, SALON_SUF)}` : `${pick(r, PREFIX)} ${pick(r, PREFIX)} ${pick(r, SUFFIX)}`.replace(/^(\w+) \1/, '$1');
      const slug = name.toLowerCase().replace(/[^a-z]+/g, '');
      const first = pick(r, western ? W_FIRST : FIRST), last = pick(r, western ? W_LAST : LAST);
      const kw = q.keywords.length && r() < 0.6 ? pick(r, q.keywords) : industry.toLowerCase();
      out.push({
        companyName: name,
        contactName: `${first} ${last}`,
        designation: q.roles.length && r() < 0.6 ? pick(r, q.roles) : pick(r, western ? W_ROLES : ROLES),
        email: r() < 0.7 ? `${first.toLowerCase()}@${slug}.example.com` : undefined,
        // Reserved fictional ranges: US 555-01xx, UK Ofcom drama numbers 020 7946 0xxx
        phone: r() < 0.9 ? (au ? `+61 491 570 ${String(110 + Math.floor(r() * 50))}` : uk ? `+44 20 7946 0${String(Math.floor(r() * 1000)).padStart(3, '0')}` : `+1 ${pick(r, ['512', '214', '305', '212', '310', '312'])}-555-01${String(Math.floor(r() * 100)).padStart(2, '0')}`) : undefined,
        website: `https://${slug}.example.com`,
        city, state: st, country: uk ? 'United Kingdom' : country,
        industry: ngo ? 'Non-profit' : salon ? (r() < 0.8 ? 'Beauty & Personal Care' : industry) : industry,
        companySize: pick(r, SIZES),
        description: `${name} is a ${industry.toLowerCase()} business in ${city} looking at ${kw} and growth initiatives.`,
        sourceRef: `sbx-${seed.toString(36)}-${i}`,
      });
    }
    return out;
  },
};
