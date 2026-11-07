import dns from 'node:dns/promises';
import net from 'node:net';
import { env } from '../config/env.js';

/** SSRF guard: block loopback, link-local and private ranges. */
export async function isPrivateHost(host: string): Promise<boolean> {
  if (env.isTest && process.env.ALLOW_PRIVATE_FETCH === '1') return false;
  if (/^localhost$/i.test(host) || host.endsWith('.local') || host.endsWith('.internal')) return true;
  let ips: string[] = [];
  if (net.isIP(host)) ips = [host];
  else { try { ips = (await dns.lookup(host, { all: true })).map((a) => a.address); } catch { return false; } }
  return ips.some((ip) => {
    if (net.isIPv6(ip)) return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80') || ip.startsWith('::ffff:127.');
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  });
}
