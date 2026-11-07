import { env } from '../../config/env.js';
import { fetchWithRetry, jsonOrThrow } from '../http.js';
import type { LeadProvider, DiscoveryQuery, RawLead } from './types.js';
import { sleep } from '../../lib/time.js';

/** Google Places API (New) — Text Search. Returns businesses with public phone/website. https://developers.google.com/maps/documentation/places/web-service/text-search */
export const googlePlaces: LeadProvider = {
  id: 'google_places',
  label: 'Google Places (business directory)',
  configured: () => !!env.GOOGLE_PLACES_API_KEY,
  async discover(q: DiscoveryQuery) {
    const terms = (q.keywords.length ? q.keywords : q.industries).slice(0, 5);
    const locations = q.locations.length ? q.locations.slice(0, 5) : [''];
    const out: RawLead[] = [];
    for (const term of terms) {
      for (const loc of locations) {
        let pageToken: string | undefined;
        for (let page = 0; page < 3 && out.length < q.limit; page++) {
          const res = await fetchWithRetry('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY!,
              'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri,places.primaryTypeDisplayName,places.addressComponents,places.editorialSummary,places.businessStatus,nextPageToken',
            },
            body: JSON.stringify({ textQuery: [term, loc && `in ${loc}`].filter(Boolean).join(' '), pageSize: 20, pageToken }),
          });
          const data = await jsonOrThrow(res, 'Google Places');
          for (const p of data.places ?? []) {
            if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
            const comp = (t: string) => p.addressComponents?.find((c: any) => c.types?.includes(t))?.longText;
            out.push({
              companyName: p.displayName?.text,
              phone: p.internationalPhoneNumber,
              website: p.websiteUri,
              address: p.formattedAddress,
              city: comp('locality'),
              state: comp('administrative_area_level_1'),
              country: comp('country'),
              industry: p.primaryTypeDisplayName?.text,
              description: p.editorialSummary?.text,
              sourceRef: p.id,
            });
          }
          pageToken = data.nextPageToken;
          if (!pageToken) break;
          await sleep(300);
        }
      }
    }
    return out.slice(0, q.limit);
  },
};
