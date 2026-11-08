/**
 * How the business is named out loud and on screen. Freelancers can leave the business name empty: then the
 * agent speaks for the owner by first name (“I work with Abbas”, “Abbas helps…”) instead of repeating a name.
 */
export function brandName(b: any) { return (b?.name || b?.ownerName || 'our team').trim(); }
export function isSolo(b: any) { return !b?.name?.trim(); }
export function ownerFirst(b: any) { return String(b?.ownerName ?? '').trim().split(/\s+/)[0] || 'the owner'; }
/** “we help salon owners…” → “Abbas helps salon owners…” for freelancers. */
export function speakAs(b: any, sentence: string) {
  if (!isSolo(b)) return sentence;
  return sentence.replace(/^we help\b/i, `${ownerFirst(b)} helps`).replace(/\bwe help\b/gi, `${ownerFirst(b)} helps`);
}
