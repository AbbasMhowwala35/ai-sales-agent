import { googlePlaces } from './googlePlaces.js';
import { apollo } from './apollo.js';
import { sandbox } from './sandbox.js';
import type { LeadProvider } from './types.js';

export const leadProviders: LeadProvider[] = [googlePlaces, apollo, sandbox];
export const getLeadProvider = (id: string) => leadProviders.find((p) => p.id === id);
export function listLeadProviders() {
  return leadProviders.map((p) => ({ id: p.id, label: p.label, configured: p.configured() }));
}
