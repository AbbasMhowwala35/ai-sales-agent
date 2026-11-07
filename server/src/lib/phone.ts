import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/** Normalises a phone number to E.164. Returns undefined when not a valid number. */
export function toE164(raw?: string | null, defaultCountry: CountryCode = 'IN'): string | undefined {
  if (!raw) return undefined;
  const p = parsePhoneNumberFromString(String(raw), defaultCountry);
  return p && p.isValid() ? p.number : undefined;
}

export function phoneCountry(e164?: string): string | undefined {
  if (!e164) return undefined;
  return parsePhoneNumberFromString(e164)?.country;
}

export function maskPhone(e164?: string | null) {
  if (!e164) return '';
  return e164.slice(0, 4) + '•••••' + e164.slice(-3);
}
