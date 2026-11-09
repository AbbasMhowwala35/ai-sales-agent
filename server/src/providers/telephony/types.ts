export interface DialRequest {
  callId: string;
  businessId: string;
  to: string;
  from?: string;
  vapiPhoneNumberId?: string;
  agent: any;
  business: any;
  lead: any;
  campaign?: any;
  record: boolean;
}
export interface TelephonyProvider {
  id: 'twilio' | 'vapi' | 'telnyx' | 'simulator';
  dial(req: DialRequest): Promise<{ providerCallId: string }>;
  hangup?(providerCallId: string): Promise<void>;
}
