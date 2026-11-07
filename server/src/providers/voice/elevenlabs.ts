import { env } from '../../config/env.js';
import { fetchWithRetry } from '../http.js';
import { sha256 } from '../../lib/crypto.js';
import { storage } from '../storage/index.js';

/** Curated ElevenLabs premade voices — natural, conversational, phone-friendly. */
export const ELEVEN_VOICES = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', accent: 'American', vibe: 'Warm, reassuring — great default for sales' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female', accent: 'American', vibe: 'Calm, clear, professional' },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'female', accent: 'American', vibe: 'Bright, expressive, friendly' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', accent: 'American', vibe: 'Upbeat and confident' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', accent: 'British', vibe: 'Warm, polished — ideal for UK calls' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', gender: 'female', accent: 'British', vibe: 'Confident, articulate' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male', accent: 'American', vibe: 'Deep, steady, trustworthy' },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', gender: 'male', accent: 'American', vibe: 'Casual, easy-going' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', accent: 'British', vibe: 'Warm, mature, persuasive' },
];

export const elevenEnabled = () => !!env.ELEVENLABS_API_KEY;

export async function elevenTts(text: string, voiceId: string, opts: { speed?: number } = {}): Promise<Buffer> {
  const res = await fetchWithRetry(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_22050_32`, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY!, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text, model_id: env.ELEVENLABS_MODEL,
      // lower stability = more natural variation; speaker boost keeps it crisp on phone lines
      voice_settings: { stability: 0.38, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true, speed: Math.min(1.2, Math.max(0.8, opts.speed ?? 1)) },
    }),
    timeoutMs: 20_000,
  }, 2);
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Synthesize once and cache by content hash; returns a storage key servable to Twilio <Play>. */
export async function cachedTts(businessId: string, text: string, voiceId: string, speed = 1) {
  const h = sha256(`${voiceId}|${speed}|${text}`);
  const key = `${businessId}/tts/${h}.mp3`;
  if (!storage.exists(key)) await storage.put(key, await elevenTts(text, voiceId, { speed }));
  return { key, hash: h };
}

/** Instant Voice Clone — requires the speaker’s consent (enforced at the API layer). */
export async function elevenClone(name: string, files: { buffer: Buffer; filename: string; mimetype: string }[], description: string) {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('description', description);
  fd.append('remove_background_noise', 'true');
  for (const f of files) fd.append('files', new Blob([new Uint8Array(f.buffer)], { type: f.mimetype }), f.filename);
  const res = await fetchWithRetry('https://api.elevenlabs.io/v1/voices/add', { method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY! }, body: fd, timeoutMs: 120_000 }, 1);
  const text = await res.text();
  if (!res.ok) throw new Error(`Voice cloning failed (${res.status}): ${text.slice(0, 200)}`);
  return JSON.parse(text).voice_id as string;
}
