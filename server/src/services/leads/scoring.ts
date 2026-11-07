import { tokenize } from '../../providers/embeddings/index.js';
import type { NormalizedLead } from './normalize.js';

export interface ScoreResult { score: number; temperature: 'hot' | 'warm' | 'cold'; breakdown: { factor: string; points: number; reason: string }[] }

const lc = (s?: string) => (s ?? '').toLowerCase();
const anyMatch = (hay: string, needles: string[]) => needles.find((n) => n && hay.includes(n.toLowerCase()));

function tokenOverlap(text: string, terms: string[]) {
  const t = new Set(tokenize(text));
  return terms.filter((term) => tokenize(term).some((x) => t.has(x)));
}

/**
 * Transparent, explainable ICP fit score (0–100).
 *  Industry fit 25 · Location fit 15 · Decision-maker 15 · Keyword/need fit 20 · Company size 5 · Contactability 20
 */
export function scoreLead(lead: Partial<NormalizedLead> & { companyName: string }, business: any): ScoreResult {
  const icp = business.icp ?? {};
  const q = business.qualification ?? {};
  const b: ScoreResult['breakdown'] = [];
  const add = (factor: string, points: number, reason: string) => b.push({ factor, points, reason });

  const industries: string[] = icp.industries ?? [];
  const ind = lc(lead.industry) + ' ' + lc(lead.description);
  if (!industries.length) add('Industry', 12, 'No target industries configured');
  else {
    const m = anyMatch(ind, industries) ?? tokenOverlap(ind, industries)[0];
    add('Industry', m ? 25 : 0, m ? `Matches target industry “${m}”` : 'Industry outside ICP');
  }

  const locs: string[] = business.targetLocations ?? [];
  const where = [lead.location?.city, lead.location?.state, lead.location?.country, lead.location?.address].map(lc).join(' ');
  if (!locs.length) add('Location', 8, 'No target locations configured');
  else {
    const m = locs.find((l) => l.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).some((part, i) => i === 0 ? where.includes(part) : false));
    const country = !m && locs.find((l) => { const c = l.split(',').pop()!.trim().toLowerCase(); return c && where.includes(c); });
    add('Location', m ? 15 : country ? 7 : 0, m ? `In target area “${m}”` : country ? `Same country as target “${country}”` : 'Outside target locations');
  }

  const roles: string[] = icp.roles ?? [];
  const title = lc(lead.designation);
  const senior = /(founder|owner|ceo|cto|cfo|coo|chief|director|head|vp|vice president|president|partner|manager|gm)/;
  if (!title) add('Decision maker', 0, 'No contact designation');
  else if (roles.length && (anyMatch(title, roles) || tokenOverlap(title, roles).length)) add('Decision maker', 15, `Designation “${lead.designation}” matches target role`);
  else if (senior.test(title)) add('Decision maker', 10, `Senior designation “${lead.designation}”`);
  else add('Decision maker', 3, `Designation “${lead.designation}” is not a target role`);

  const kws: string[] = [...(icp.keywords ?? []), ...(business.products ?? []).map((p: any) => p.name), ...(business.services ?? []).map((p: any) => p.name)].filter(Boolean);
  if (kws.length) {
    const text = `${lead.companyName} ${lead.description ?? ''} ${lead.industry ?? ''}`;
    const hits = [...new Set(tokenOverlap(text, kws))];
    const pts = Math.min(20, hits.length * 8);
    add('Need fit', pts, hits.length ? `Mentions ${hits.slice(0, 3).join(', ')}` : 'No ICP keywords found in profile');
  } else add('Need fit', 8, 'No ICP keywords configured');

  const sizes: string[] = icp.companySizes ?? [];
  if (sizes.length && lead.companySize) add('Company size', sizes.includes(lead.companySize) ? 5 : 0, sizes.includes(lead.companySize) ? `Size ${lead.companySize} in ICP` : `Size ${lead.companySize} outside ICP`);
  else add('Company size', 2, 'Company size unknown');

  let contact = 0; const parts: string[] = [];
  if (lead.phone) { contact += 10; parts.push('phone'); }
  if (lead.email) { contact += 5; parts.push('email'); }
  if (lead.website) { contact += 3; parts.push('website'); }
  if (lead.contactName) { contact += 2; parts.push('named contact'); }
  add('Contactability', contact, parts.length ? `Has ${parts.join(', ')}` : 'No contact details');

  const score = Math.max(0, Math.min(100, Math.round(b.reduce((s, x) => s + x.points, 0))));
  const hot = q.hotThreshold ?? 70, warm = q.warmThreshold ?? 40;
  return { score, temperature: score >= hot ? 'hot' : score >= warm ? 'warm' : 'cold', breakdown: b };
}
