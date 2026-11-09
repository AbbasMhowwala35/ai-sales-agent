/**
 * Free in-browser voice: speech-to-text with the browser's built-in recognition (Chrome, Edge, Safari) and
 * text-to-speech with either natural audio from the server (ElevenLabs, when configured) or the browser's voice.
 */
let current: HTMLAudioElement | null = null;

export function stopSpeaking() { current?.pause(); current = null; if ('speechSynthesis' in window) speechSynthesis.cancel(); }

/** Speak `text`. `fetchAudio` may return natural audio (200) or nothing (204) → browser voice. Resolves when done. */
export async function speak(text: string, opts: { lang?: string; rate?: number; fetchAudio?: () => Promise<Response | null> } = {}) {
  stopSpeaking();
  try {
    const res = opts.fetchAudio ? await opts.fetchAudio() : null;
    if (res && res.status === 200) {
      const url = URL.createObjectURL(await res.blob());
      await new Promise<void>((resolve) => {
        current = new Audio(url);
        current.onended = () => { URL.revokeObjectURL(url); resolve(); };
        current.onerror = () => resolve();
        current.play().catch(() => resolve());
      });
      return;
    }
  } catch { /* use the browser voice */ }
  if (!('speechSynthesis' in window)) return;
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const lang = opts.lang ?? 'en-US';
    const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(lang.slice(0, 2)));
    const female = /female|samantha|victoria|karen|moira|serena|zira|jenny|aria|sonia|libby|google (us|uk) english$/i;
    u.voice = vs.find((v) => v.lang === lang && female.test(v.name)) ?? vs.find((v) => v.lang === lang) ?? vs[0] ?? null;
    u.lang = lang; u.rate = opts.rate ?? 1;
    u.onend = () => resolve(); u.onerror = () => resolve();
    speechSynthesis.speak(u);
    setTimeout(resolve, Math.min(30000, 1500 + text.length * 90)); // safety net if onend never fires
  });
}

type Rec = { start(): void; stop(): void; abort(): void; lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean; onresult: any; onerror: any; onend: any };
const RecCtor = (): (new () => Rec) | null => (typeof window !== 'undefined' ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null) : null);
export const canListen = () => !!RecCtor();

let active: Rec | null = null;
export function stopListening() { try { active?.abort(); } catch { /* */ } active = null; }

/** Listen once; resolves with what the person said ('' if nothing). Rejects if the microphone is blocked. */
export function listen(lang = 'en-US'): Promise<string> {
  const C = RecCtor();
  if (!C) return Promise.reject(new Error('Voice input isn’t supported in this browser — try Chrome, or type instead.'));
  stopListening();
  return new Promise((resolve, reject) => {
    const r = new C(); active = r;
    r.lang = lang; r.interimResults = false; r.maxAlternatives = 1; r.continuous = false;
    let said = '';
    r.onresult = (e: any) => { said = Array.from(e.results).map((x: any) => x[0]?.transcript ?? '').join(' ').trim(); };
    r.onerror = (e: any) => { active = null; if (e.error === 'not-allowed' || e.error === 'service-not-allowed') reject(new Error('Microphone access is blocked — allow it in your browser and try again.')); else if (e.error === 'no-speech' || e.error === 'aborted') resolve(''); else resolve(''); };
    r.onend = () => { active = null; resolve(said); };
    try { r.start(); } catch (e: any) { active = null; reject(e); }
  });
}
