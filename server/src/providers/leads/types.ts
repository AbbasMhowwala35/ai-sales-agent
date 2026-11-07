export interface DiscoveryQuery {
  keywords: string[];
  industries: string[];
  locations: string[];
  roles: string[];
  companySizes: string[];
  limit: number;
}
export interface RawLead {
  companyName: string;
  contactName?: string;
  designation?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  industry?: string;
  companySize?: string;
  description?: string;
  sourceRef?: string;
  category?: string;
}
export interface LeadProvider {
  id: string;
  label: string;
  configured(): boolean;
  discover(q: DiscoveryQuery): Promise<RawLead[]>;
}
