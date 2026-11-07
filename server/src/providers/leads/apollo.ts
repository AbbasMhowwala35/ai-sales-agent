import { env } from '../../config/env.js';
import { fetchWithRetry, jsonOrThrow } from '../http.js';
import type { LeadProvider, DiscoveryQuery, RawLead } from './types.js';

const SIZE_RANGES: Record<string, string> = { '1-10': '1,10', '11-50': '11,50', '51-200': '51,200', '201-500': '201,500', '501-1000': '501,1000', '1000+': '1001,1000000' };

/** Apollo.io People Search — decision makers at companies matching the ICP. https://docs.apollo.io/reference/people-api-search */
export const apollo: LeadProvider = {
  id: 'apollo',
  label: 'Apollo.io (B2B contacts)',
  configured: () => !!env.APOLLO_API_KEY,
  async discover(q: DiscoveryQuery) {
    const out: RawLead[] = [];
    for (let page = 1; page <= 5 && out.length < q.limit; page++) {
      const res = await fetchWithRetry('https://api.apollo.io/api/v1/mixed_people/api_search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.APOLLO_API_KEY!, 'cache-control': 'no-cache' },
        body: JSON.stringify({
          person_titles: q.roles,
          person_locations: q.locations,
          q_organization_keyword_tags: [...q.keywords, ...q.industries].slice(0, 10),
          organization_num_employees_ranges: q.companySizes.map((s) => SIZE_RANGES[s]).filter(Boolean),
          page,
          per_page: Math.min(100, q.limit),
        }),
      });
      const data = await jsonOrThrow(res, 'Apollo');
      const people = data.people ?? [];
      for (const p of people) {
        const org = p.organization ?? {};
        out.push({
          companyName: org.name ?? p.organization_name,
          contactName: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.name,
          designation: p.title,
          email: p.email && !String(p.email).includes('not_unlocked') ? p.email : undefined,
          phone: p.phone_numbers?.[0]?.sanitized_number ?? org.primary_phone?.sanitized_number ?? org.phone,
          website: org.website_url,
          city: p.city ?? org.city,
          state: p.state ?? org.state,
          country: p.country ?? org.country,
          industry: org.industry,
          companySize: org.estimated_num_employees ? String(org.estimated_num_employees) : undefined,
          description: org.short_description,
          sourceRef: p.id,
        });
      }
      if (people.length < Math.min(100, q.limit)) break;
    }
    return out.filter((l) => l.companyName).slice(0, q.limit);
  },
};
