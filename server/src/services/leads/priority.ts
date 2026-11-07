import * as cheerio from 'cheerio';
import { fetchWithRetry } from '../../providers/http.js';
import { isPrivateHost } from '../../lib/net.js';
import { Lead } from '../../models/index.js';
import { logger } from '../../lib/logger.js';

export interface WebsiteAudit {
  checkedAt: Date; hasWebsite: boolean; reachable: boolean; score: number; https: boolean; mobileFriendly: boolean;
  onlineBooking: boolean; contactForm: boolean; copyrightYear?: number; platform?: string; issues: string[];
}

const BOOKING_RE = /(book (now|online|an appointment)|schedule (now|online)|appointments?|reserve|booksy|vagaro|fresha|square ?appointments|mindbody|calendly|acuity|setmore|glossgenius|schedulicity|zocdoc|opentable)/i;

/** Grade a homepage 0–100 on the things a buyer would notice: security, mobile, freshness, conversion paths. */
export function gradeHtml(html: string, finalUrl: string): Omit<WebsiteAudit, 'checkedAt' | 'hasWebsite' | 'reachable'> {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ');
  const issues: string[] = [];
  const https = finalUrl.startsWith('https://');
  const mobileFriendly = /width=device-width/i.test($('meta[name="viewport"]').attr('content') ?? '');
  const links = $('a').map((_, a) => `${$(a).text()} ${$(a).attr('href') ?? ''}`).get().join(' ');
  const onlineBooking = BOOKING_RE.test(links) || BOOKING_RE.test($('iframe,script').map((_, e) => $(e).attr('src') ?? '').get().join(' '));
  const contactForm = $('form').toArray().some((f) => /email|phone|message|name/i.test($(f).html() ?? ''));
  const years = [...text.matchAll(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1])).filter((y) => y > 1995);
  const copyrightYear = years.length ? Math.max(...years) : undefined;
  const gen = $('meta[name="generator"]').attr('content') ?? '';
  const platform = /wix/i.test(html) ? 'Wix' : /squarespace/i.test(html) ? 'Squarespace' : /wordpress|wp-content/i.test(html) ? 'WordPress' : /shopify/i.test(html) ? 'Shopify' : /webflow/i.test(html) ? 'Webflow' : gen || undefined;
  let score = 100;
  if (!https) { score -= 20; issues.push('No HTTPS (shows “Not secure”)'); }
  if (!mobileFriendly) { score -= 25; issues.push('Not mobile-friendly'); }
  const thisYear = new Date().getFullYear();
  if (copyrightYear && copyrightYear < thisYear - 2) { score -= 15; issues.push(`Looks outdated (© ${copyrightYear})`); }
  if (!$('title').text().trim() || !$('meta[name="description"]').attr('content')) { score -= 10; issues.push('Missing title or description (weak on Google)'); }
  if (!contactForm) { score -= 10; issues.push('No contact form'); }
  if (!onlineBooking) { score -= 10; issues.push('No online booking'); }
  if ($('table[width], font, marquee, center').length > 3 || /swfobject|\.swf/i.test(html)) { score -= 15; issues.push('Old-fashioned page layout'); }
  if (text.length < 400) { score -= 10; issues.push('Very little content'); }
  return { score: Math.max(0, score), https, mobileFriendly, onlineBooking, contactForm, copyrightYear, platform, issues };
}

function hashNum(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

/** Fetch & grade the lead’s website. Sandbox (example.com) sites get a deterministic synthetic audit. */
export async function auditWebsite(url?: string | null, sandbox = false): Promise<WebsiteAudit> {
  const checkedAt = new Date();
  if (!url) return { checkedAt, hasWebsite: false, reachable: false, score: 0, https: false, mobileFriendly: false, onlineBooking: false, contactForm: false, issues: ['No website'] };
  if (sandbox || /\.example\.(com|org)/i.test(url)) {
    const h = hashNum(url);
    const tier = h % 10; // 0-2 no site, 3-6 basic, 7-9 good
    if (tier <= 2) return { checkedAt, hasWebsite: false, reachable: false, score: 0, https: false, mobileFriendly: false, onlineBooking: false, contactForm: false, issues: ['No website (domain parked or not found)'] };
    const good = tier >= 7;
    const issues = good ? ['Needs ongoing updates & maintenance'] : ['Not mobile-friendly', 'No online booking', ...(h % 2 ? ['Looks outdated (© 2019)'] : [])];
    return { checkedAt, hasWebsite: true, reachable: true, score: good ? 82 + (h % 15) : 30 + (h % 25), https: good || h % 3 === 0, mobileFriendly: good, onlineBooking: good && h % 2 === 0, contactForm: good, copyrightYear: good ? new Date().getFullYear() : 2019, platform: ['Wix', 'WordPress', 'Squarespace'][h % 3], issues };
  }
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (await isPrivateHost(u.hostname)) throw new Error('blocked');
    const res = await fetchWithRetry(u.href, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; DialstackAudit/1.0)' }, timeoutMs: 9000, redirect: 'follow' }, 1);
    if (!res.ok) return { checkedAt, hasWebsite: true, reachable: false, score: 10, https: u.protocol === 'https:', mobileFriendly: false, onlineBooking: false, contactForm: false, issues: [`Website returns an error (${res.status})`] };
    const html = (await res.text()).slice(0, 1_500_000);
    return { checkedAt, hasWebsite: true, reachable: true, ...gradeHtml(html, res.url || u.href) };
  } catch {
    return { checkedAt, hasWebsite: true, reachable: false, score: 5, https: false, mobileFriendly: false, onlineBooking: false, contactForm: false, issues: ['Website is down or unreachable'] };
  }
}

export interface PriorityRule { priority: number; label?: string; signal: string; value?: string }
export const usesWebsite = (rules: PriorityRule[]) => rules.some((r) => /website|booking|mobile|https/.test(r.signal));

function matches(rule: PriorityRule, lead: any) {
  const a = lead.websiteAudit;
  const hay = `${lead.companyName} ${lead.description ?? ''} ${lead.industry ?? ''}`.toLowerCase();
  switch (rule.signal) {
    case 'no_website': return a ? !a.hasWebsite || !a.reachable : !lead.website;
    case 'weak_website': return !!a?.hasWebsite && a.reachable && (a.score ?? 0) < 60;
    case 'good_website': return !!a?.hasWebsite && a.reachable && (a.score ?? 0) >= 60;
    case 'no_online_booking': return !!a && !a.onlineBooking;
    case 'has_online_booking': return !!a?.onlineBooking;
    case 'not_mobile_friendly': return !!a?.hasWebsite && !a.mobileFriendly;
    case 'no_https': return !!a?.hasWebsite && !a.https;
    case 'outdated_website': return !!a?.copyrightYear && a.copyrightYear < new Date().getFullYear() - 2;
    case 'keyword_present': return !!rule.value && hay.includes(rule.value.toLowerCase());
    case 'keyword_absent': return !!rule.value && !hay.includes(rule.value.toLowerCase());
    case 'any': return true;
    default: return false;
  }
}

/** Priority 1 = needs us most. First matching rule (lowest number) wins; no rules → no priority. */
export function computePriority(lead: any, rules: PriorityRule[] = []): { priority?: number; reason?: string } {
  const sorted = [...rules].sort((x, y) => x.priority - y.priority);
  for (const r of sorted) if (matches(r, lead)) return { priority: r.priority, reason: r.label || r.signal.replace(/_/g, ' ') };
  return {};
}

/** Audit (if rules need it) and assign a priority to a set of leads. */
export async function prioritizeLeads(business: any, leadIds: unknown[]) {
  const rules: PriorityRule[] = business.priorityRules ?? [];
  if (!rules.length) return 0;
  let n = 0;
  for (const id of leadIds) {
    const lead = await Lead.findOne({ businessId: business._id, _id: id });
    if (!lead) continue;
    try {
      if (usesWebsite(rules) && !lead.websiteAudit?.checkedAt) lead.set('websiteAudit', await auditWebsite(lead.website, (lead.tags ?? []).includes('sandbox')));
      const p = computePriority(lead.toObject({ getters: true }), rules);
      lead.set({ priority: p.priority, priorityReason: p.reason });
      await lead.save(); n++;
    } catch (e: any) { logger.warn({ err: e.message, lead: String(id) }, 'prioritize failed'); }
  }
  return n;
}

export const PRIORITY_TEMPLATES = {
  website_dev: { label: 'Website development', rules: [
    { priority: 1, signal: 'no_website', label: 'No website — needs one built' },
    { priority: 2, signal: 'weak_website', label: 'Basic or outdated website — needs a redesign' },
    { priority: 3, signal: 'good_website', label: 'Good website — offer maintenance & growth' },
  ] },
  booking_software: { label: 'Booking / scheduling software', rules: [
    { priority: 1, signal: 'no_website', label: 'No website or online booking at all' },
    { priority: 2, signal: 'no_online_booking', label: 'Website but no online booking' },
    { priority: 3, signal: 'has_online_booking', label: 'Already books online — offer a switch' },
  ] },
  seo_marketing: { label: 'SEO / digital marketing', rules: [
    { priority: 1, signal: 'weak_website', label: 'Weak website — poor on Google' },
    { priority: 2, signal: 'not_mobile_friendly', label: 'Not mobile-friendly' },
    { priority: 3, signal: 'good_website', label: 'Good site — grow traffic' },
  ] },
};
