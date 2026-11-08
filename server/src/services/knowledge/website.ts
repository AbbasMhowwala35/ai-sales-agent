import { fetchWithRetry } from '../../providers/http.js';
import { htmlToText } from './extract.js';
import { badRequest } from '../../lib/errors.js';
import { isPrivateHost } from '../../lib/net.js';

/** Same-origin crawl (breadth-first) with page/char limits. Respects robots.txt Disallow for `*`. */
export async function crawlWebsite(startUrl: string, maxPages = 10) {
  let url: URL;
  try { url = new URL(startUrl.startsWith('http') ? startUrl : `https://${startUrl}`); } catch { throw badRequest('Invalid website URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw badRequest('Only http(s) URLs are supported');
  if (await isPrivateHost(url.hostname)) throw badRequest('That address is not allowed');

  const disallow = await robotsDisallow(url.origin);
  const queue = [url.href.split('#')[0]];
  const seen = new Set<string>();
  const pages: { url: string; title: string; text: string }[] = [];
  while (queue.length && pages.length < maxPages) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const path = new URL(next).pathname;
    if (disallow.some((d) => d && path.startsWith(d))) continue;
    try {
      const res = await fetchWithRetry(next, { headers: { 'user-agent': 'AISalesAgentBot/1.0 (+knowledge-import)', accept: 'text/html' }, timeoutMs: 15000, redirect: 'follow' }, 1);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) continue;
      const html = (await res.text()).slice(0, 800_000);
      const { title, text, links } = htmlToText(html);
      if (text.length > 50) pages.push({ url: next, title, text });
      for (const l of links) {
        try {
          const u = new URL(l, next);
          if (u.origin === url.origin && !/\.(pdf|jpg|jpeg|png|gif|zip|mp4|svg|webp)$/i.test(u.pathname)) queue.push(u.href.split('#')[0]);
        } catch { /* ignore */ }
      }
    } catch { /* skip page */ }
  }
  if (!pages.length) throw badRequest('Could not read any content from that website');
  return pages;
}

async function robotsDisallow(origin: string): Promise<string[]> {
  try {
    const res = await fetchWithRetry(`${origin}/robots.txt`, { timeoutMs: 5000 }, 0);
    if (!res.ok) return [];
    const lines = (await res.text()).split('\n');
    const out: string[] = [];
    let applies = false;
    for (const raw of lines) {
      const line = raw.split('#')[0].trim();
      const [k, ...v] = line.split(':');
      const val = v.join(':').trim();
      if (/^user-agent$/i.test(k)) applies = val === '*' || /aisalesagent/i.test(val);
      else if (applies && /^disallow$/i.test(k) && val) out.push(val);
    }
    return out;
  } catch { return []; }
}
