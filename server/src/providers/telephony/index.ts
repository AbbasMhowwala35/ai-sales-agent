import { env } from '../../config/env.js';
import { twilio } from './twilio.js';
import { vapi } from './vapi.js';
import { simulator } from './simulator.js';
import type { TelephonyProvider } from './types.js';

let override: TelephonyProvider | null = null;
export function getTelephony(): TelephonyProvider {
  if (override) return override;
  return env.TELEPHONY_PROVIDER === 'twilio' ? twilio : env.TELEPHONY_PROVIDER === 'vapi' ? vapi : simulator;
}
export function setTelephony(p: TelephonyProvider | null) { override = p; }
