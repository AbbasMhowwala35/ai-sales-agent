/**
 * The agent works out its own pitch for any campaign: WHO it's calling (the campaign's category — salons, NGOs,
 * dentists, law firms…) × WHAT the business sells (booking software, websites, marketing, CRM…).
 * No settings to fill in: the category supplies the vocabulary (clients / patients / donors…), the business's
 * own products supply the problems it can actually solve.
 */
export interface Audience {
  key: string; owners: string; customers: string; customer: string; bookings: string; slots: string;
  busy: string; action: string;
}

const A = (key: string, owners: string, customers: string, customer: string, bookings: string, slots: string, busy: string, action: string): Audience =>
  ({ key, owners, customers, customer, bookings, slots, busy, action });

const AUDIENCES: [RegExp, Audience][] = [
  [/salon|spa|barber|nail|beauty|hair|lash|brow|wax|tattoo/i, A('salon', 'salon owners', 'clients', 'client', 'appointments', 'chairs', 'with a client', 'booking')],
  [/dent|clinic|doctor|medical|physio|chiro|therap|health|hospital|optic|derma|pharma/i, A('clinic', 'clinic owners', 'patients', 'patient', 'appointments', 'appointment slots', 'with a patient', 'booking an appointment')],
  [/vet|pet|groom|animal/i, A('vet', 'practice owners', 'pet owners', 'pet owner', 'appointments', 'appointment slots', 'with a patient', 'booking')],
  [/restaurant|cafe|café|coffee|bar\b|pub|bakery|bistro|diner|food|catering|kitchen/i, A('restaurant', 'restaurant owners', 'diners', 'diner', 'reservations', 'tables', 'in the middle of service', 'booking a table')],
  [/gym|fitness|yoga|pilates|crossfit|martial|dance|studio/i, A('gym', 'studio owners', 'members', 'member', 'classes', 'class spots', 'running a class', 'signing up')],
  [/real ?estate|realtor|property|letting|broker/i, A('realestate', 'real estate agents', 'buyers', 'buyer', 'viewings', 'viewing slots', 'out at a viewing', 'getting in touch')],
  [/law|legal|attorney|solicitor|notary/i, A('law', 'law firms', 'clients', 'client', 'consultations', 'consultation slots', 'in court or with a client', 'booking a consultation')],
  [/ngo|non.?profit|charity|foundation|trust|ministry|church|mosque|temple/i, A('ngo', 'nonprofits', 'donors', 'donor', 'events', 'event spots', 'out in the field', 'donating')],
  [/school|coaching|tuition|tutor|academy|college|education|training|institute|preschool|daycare/i, A('school', 'schools', 'parents and students', 'student', 'admissions', 'seats', 'teaching', 'enrolling')],
  [/hotel|hostel|motel|resort|b&b|guest ?house|homestay|airbnb/i, A('hotel', 'hotel owners', 'guests', 'guest', 'bookings', 'rooms', 'with guests', 'booking a room')],
  [/e-?commerce|online (store|shop)|d2c|shopify/i, A('ecom', 'online store owners', 'shoppers', 'shopper', 'orders', 'orders', 'packing orders', 'checking out')],
  [/retail|shop|store|boutique|showroom|jewel|furniture|florist/i, A('retail', 'store owners', 'customers', 'customer', 'orders', 'sales', 'with a customer', 'buying')],
  [/auto|garage|mechanic|car (wash|dealer)|tyre|tire|body shop/i, A('auto', 'garage owners', 'customers', 'customer', 'services', 'service bays', 'under a car', 'booking a service')],
  [/plumb|electric|hvac|clean|pest|roof|landscap|contractor|construction|builder|handyman|painting|movers?|home service/i, A('trades', 'contractors', 'customers', 'customer', 'jobs', 'job slots', 'out on a job', 'requesting a quote')],
  [/account|cpa|bookkeep|tax|audit|finance|insurance|advisor|wealth/i, A('advisory', 'firms', 'clients', 'client', 'meetings', 'meeting slots', 'with a client', 'getting in touch')],
  [/photo|video|wedding|event|venue|planner|dj/i, A('events', 'studio owners', 'clients', 'client', 'shoots', 'dates', 'on a shoot', 'booking a date')],
  [/travel|tour|visa|immigration/i, A('travel', 'travel agencies', 'travellers', 'traveller', 'trips', 'trips', 'with a traveller', 'enquiring')],
  [/software|saas|startup|tech|app\b|agency|marketing agency|consult/i, A('b2b', 'founders', 'customers', 'customer', 'demos', 'demo slots', 'in meetings', 'signing up')],
  [/manufactur|factory|industrial|wholesale|distribut|logistic|supplier|export/i, A('industrial', 'manufacturers', 'buyers', 'buyer', 'orders', 'order slots', 'on the floor', 'sending an enquiry')],
];

export function audienceFor(category?: string): Audience {
  const c = (category ?? '').trim();
  const hit = AUDIENCES.find(([re]) => re.test(c))?.[1];
  if (hit) return hit;
  const noun = c ? c.toLowerCase().replace(/s$/, '') : 'business';
  return A('other', c ? `${noun} owners` : 'business owners', 'customers', 'customer', 'appointments', 'slots', 'busy with a customer', 'getting in touch');
}

/** What the SELLER does, read from its own description and products. Each type knows the problems it solves. */
interface OfferType { key: string; match: RegExp; reason: (a: Audience) => string; pains: (a: Audience) => string[]; impact?: (a: Audience) => string }
const OFFERS: OfferType[] = [
  { key: 'booking', match: /booking|appointment|schedul|reminder|no.?show|reservation|calendar/i,
    reason: (a) => `we help ${a.owners} stop losing money to no-shows and missed calls`,
    pains: (a) => [`${a.customers} not showing up for ${a.bookings}`, `missing calls while you’re ${a.busy}`, `quiet days with empty ${a.slots}`] },
  { key: 'website', match: /website|web ?(design|development|site)|landing page|wordpress|webflow|seo|search engine/i,
    reason: (a) => `we help ${a.owners} get found on Google and turn website visitors into ${a.customers}`,
    impact: (a) => `Roughly how many ${a.customers} reach out through the website in a typical week?`,
    pains: (a) => [`not showing up on Google when people search`, `a website that looks dated or breaks on mobile`, `visitors leaving without ${a.action}`] },
  { key: 'marketing', match: /marketing|advertis|ads\b|social media|instagram|facebook|lead gen|branding|content/i,
    reason: (a) => `we help ${a.owners} bring in more ${a.customers} without wasting money on ads`,
    impact: (a) => `Roughly how many new ${a.customers} come in during a typical month?`,
    pains: (a) => [`not enough new ${a.customers} coming in`, `ad spend that doesn’t turn into ${a.customers}`, `no time to keep up with social media`] },
  { key: 'crm', match: /crm|follow.?up|whatsapp|pipeline|customer (follow|retention)|loyalty|automation/i,
    reason: (a) => `we help ${a.owners} follow up with every ${a.customer} automatically`,
    impact: (a) => `Roughly how many ${a.customers} would you say slip through in a typical week?`,
    pains: (a) => [`${a.customers} slipping through without a follow-up`, `chasing people over WhatsApp and spreadsheets`, `not knowing who to call back first`] },
  { key: 'fundraising', match: /donat|fundrais|donor|giving|crowdfund/i,
    reason: (a) => `we help ${a.owners} raise more and keep ${a.customers} coming back`,
    impact: () => `Roughly how many first-time donors would you say don’t give again, in a typical month?`,
    pains: (a) => [`donors giving once and never again`, `a donation process that’s clunky online`, `too much time on admin instead of the mission`] },
  { key: 'accounting', match: /accounting|bookkeep|tax|payroll|invoice|gst|vat|audit/i,
    reason: (a) => `we help ${a.owners} take the books, payroll and taxes off their plate`,
    impact: () => `Roughly how many hours a week go on the books?`,
    pains: () => [`chasing late invoices`, `tax deadlines sneaking up`, `evenings lost to bookkeeping`] },
  { key: 'it', match: /it support|managed (it|services)|cyber|security|cloud|backup|network|helpdesk|software development|app development/i,
    reason: (a) => `we help ${a.owners} keep their tech running and secure`,
    impact: () => `How often does something break — like, in a typical month?`,
    pains: () => [`systems going down at the worst time`, `worrying about security or losing data`, `tech that slows the team down`] },
  { key: 'staffing', match: /staffing|recruit|hiring|talent|manpower|payroll outsourc/i,
    reason: (a) => `we help ${a.owners} find good people fast`,
    impact: () => `How many roles do you have open right now?`,
    pains: () => [`roles staying open for weeks`, `hires that don’t work out`, `no time to screen candidates`] },
];

export function offerTypeFor(business: any): OfferType | undefined {
  const text = [business?.description, business?.industry, ...(business?.products ?? []).map((p: any) => `${p.name} ${p.description ?? ''}`), ...(business?.services ?? []).map((p: any) => `${p.name} ${p.description ?? ''}`)].join(' ');
  let best: { o: OfferType; n: number } | undefined;
  for (const o of OFFERS) { const n = (text.match(new RegExp(o.match.source, 'gi')) ?? []).length; if (n && (!best || n > best.n)) best = { o, n }; }
  return best?.o;
}
