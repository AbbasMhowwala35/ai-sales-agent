import { Lead } from '../../models/index.js';
import { blindIndex } from '../../lib/crypto.js';
import type { NormalizedLead } from './normalize.js';

/**
 * A lead is a duplicate when ANY strong identifier matches an existing lead of the same business:
 * phone (blind index), email (blind index), same dedupeKey (company + contact/city),
 * or same domain AND same contact (or no contact on either side).
 */
export async function findDuplicate(businessId: unknown, l: NormalizedLead) {
  const or: any[] = [{ dedupeKey: l.dedupeKey }];
  const ph = blindIndex(l.phone); if (ph) or.push({ phoneHash: ph });
  const em = blindIndex(l.email); if (em) or.push({ emailHash: em });
  if (l.domain) or.push({ domain: l.domain, contactName: l.contactName ?? { $in: [null, undefined] } });
  return Lead.findOne({ businessId, $or: or }, { _id: 1, companyName: 1 }).lean();
}

/** In-batch de-duplication before touching the DB. */
export function dedupeBatch(leads: NormalizedLead[]) {
  const seen = new Set<string>();
  const out: NormalizedLead[] = [];
  let dupes = 0;
  for (const l of leads) {
    const keys = [l.dedupeKey, l.phone && `p:${l.phone}`, l.email && `e:${l.email}`].filter(Boolean) as string[];
    if (keys.some((k) => seen.has(k))) { dupes++; continue; }
    keys.forEach((k) => seen.add(k));
    out.push(l);
  }
  return { leads: out, dupes };
}
