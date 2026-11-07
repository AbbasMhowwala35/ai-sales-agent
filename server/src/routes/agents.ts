import { Router } from 'express';
import { z } from 'zod';
import { AIAgent, Business, Campaign } from '../models/index.js';
import { scope } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { parse } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { start, respond, newState, type ConversationState } from '../services/agent/engine.js';
import { env } from '../config/env.js';
import { getLLM } from '../providers/llm/index.js';
import multer from 'multer';
import { ELEVEN_VOICES, elevenEnabled, elevenTts, elevenClone } from '../providers/voice/elevenlabs.js';
import { forbidden } from '../lib/errors.js';
import { can } from '../middleware/rbac.js';

export const agentsRouter = Router();

const agentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  persona: z.string().trim().max(500).optional(),
  language: z.string().trim().max(10).optional(),
  voice: z.string().trim().max(60).optional(),
  voiceProvider: z.enum(['twilio', 'elevenlabs']).optional(),
  elevenVoiceId: z.string().trim().max(60).optional(),
  title: z.string().trim().max(80).optional(),
  experience: z.string().trim().max(600).optional(),
  style: z.enum(['natural', 'formal']).optional(),
  tone: z.enum(['professional', 'friendly', 'enthusiastic', 'calm', 'consultative']).optional(),
  speakingRate: z.number().min(0.5).max(2).optional(),
  objective: z.string().trim().max(1000).optional(),
  openingLine: z.string().trim().max(500).optional(),
  instructions: z.string().trim().max(5000).optional(),
  objectionHandling: z.array(z.object({ objection: z.string().trim().min(1).max(300), response: z.string().trim().min(1).max(1000) })).max(50).optional(),
  maxCallMinutes: z.number().int().min(1).max(30).optional(),
  transferNumber: z.string().trim().max(30).optional(),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** Carrier TTS voices (Twilio <Say>) — used when ElevenLabs isn’t configured. */
export const VOICES = [
  { id: 'Polly.Joanna-Neural', label: 'Joanna — US English (female, neural)', language: 'en-US' },
  { id: 'Polly.Ruth-Generative', label: 'Ruth — US English (female, generative)', language: 'en-US' },
  { id: 'Google.en-US-Neural2-F', label: 'Google — US English (female, neural)', language: 'en-US' },
  { id: 'Polly.Matthew-Neural', label: 'Matthew — US English (male, neural)', language: 'en-US' },
  { id: 'Polly.Amy-Neural', label: 'Amy — British English (female, neural)', language: 'en-GB' },
  { id: 'Google.en-GB-Neural2-A', label: 'Google — British English (female, neural)', language: 'en-GB' },
  { id: 'Polly.Olivia-Neural', label: 'Olivia — Australian English (female, neural)', language: 'en-AU' },
  { id: 'Polly.Kajal-Neural', label: 'Kajal — Indian English (female, neural)', language: 'en-IN' },
];

agentsRouter.get('/', async (req, res) => {
  res.json({
    agents: await AIAgent.find(scope(req)).sort({ isDefault: -1, createdAt: 1 }).lean(),
    voices: VOICES, naturalVoices: ELEVEN_VOICES,
    runtime: { telephony: env.TELEPHONY_PROVIDER, llm: getLLM()?.name ?? 'local-rules', elevenlabs: elevenEnabled() },
  });
});

agentsRouter.get('/:id', async (req, res) => {
  const a = await AIAgent.findOne({ ...scope(req), _id: req.params.id }).lean();
  if (!a) throw notFound('Agent');
  res.json(a);
});

agentsRouter.post('/', requirePermission('agents:write'), async (req, res) => {
  const body = parse(agentSchema, req.body);
  if (body.isDefault) await AIAgent.updateMany(scope(req), { isDefault: false });
  const count = await AIAgent.countDocuments(scope(req));
  const a = await AIAgent.create({ ...body, ...scope(req), isDefault: body.isDefault || count === 0 });
  await audit(req, 'agent.created', 'AI_Agent', a._id);
  res.status(201).json(a);
});

agentsRouter.patch('/:id', requirePermission('agents:write'), async (req, res) => {
  const body = parse(agentSchema.partial(), req.body);
  if (body.isDefault) await AIAgent.updateMany(scope(req), { isDefault: false });
  const a = await AIAgent.findOneAndUpdate({ ...scope(req), _id: req.params.id }, body, { returnDocument: 'after', runValidators: true });
  if (!a) throw notFound('Agent');
  await audit(req, 'agent.updated', 'AI_Agent', a._id, { fields: Object.keys(body) });
  res.json(a);
});

agentsRouter.delete('/:id', requirePermission('agents:write'), async (req, res) => {
  const a = await AIAgent.findOne({ ...scope(req), _id: req.params.id });
  if (!a) throw notFound('Agent');
  if (a.isDefault) throw badRequest('Set another agent as default before deleting this one');
  if (await Campaign.exists({ ...scope(req), agentId: a._id, status: { $in: ['active', 'paused'] } })) throw badRequest('This agent is used by an active or paused campaign');
  await AIAgent.deleteOne({ ...scope(req), _id: a._id });
  res.status(204).end();
});

/** Text playground running the exact same conversation engine used on live calls. */
agentsRouter.post('/:id/test-chat', async (req, res) => {
  const body = parse(z.object({
    message: z.string().max(1000).optional(),
    state: z.any().optional(),
    lead: z.object({ contactName: z.string().max(80).optional(), companyName: z.string().max(120).optional(), designation: z.string().max(80).optional() }).optional(),
    campaignId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
    category: z.string().trim().max(60).optional(),
  }), req.body);
  const [agent, business] = await Promise.all([AIAgent.findOne({ ...scope(req), _id: req.params.id }).lean(), Business.findById(req.tenant!.businessId).lean()]);
  if (!agent || !business) throw notFound('Agent');
  // Practise as a campaign (or just a category): the agent pitches exactly as it would on that campaign's calls.
  const { Campaign } = await import('../models/index.js');
  const campaign: any = body.campaignId ? await Campaign.findOne({ ...scope(req), _id: body.campaignId }).lean() : body.category ? { category: body.category } : undefined;
  const cat = campaign?.category;
  const sample = cat ? { companyName: `Test ${cat.replace(/s$/i, '')}`, industry: cat } : { companyName: 'Copper & Co. Salon', industry: 'Beauty & Personal Care' };
  const lead = { contactName: 'Jessica Miller', designation: 'Owner', location: { city: 'Austin', state: 'TX', country: 'USA' }, phone: '+15125550142', category: cat, ...sample, ...body.lead };
  const ctx = { business, agent, lead, campaign };
  if (!body.message || !body.state) {
    const s = start(ctx);
    return res.json({ reply: s.reply, state: s.state, end: false, actions: [] });
  }
  const state: ConversationState = { ...newState(), ...(body.state as object) };
  const r = await respond(ctx, state, body.message);
  res.json(r);
});

/** Voice preview: real ElevenLabs audio when configured; otherwise 204 so the browser can use a local voice. */
agentsRouter.post('/:id/voice-preview', async (req, res) => {
  const body = parse(z.object({ text: z.string().trim().min(1).max(400).optional(), voiceId: z.string().max(60).optional() }), req.body ?? {});
  const a = await AIAgent.findOne({ ...scope(req), _id: req.params.id }).lean();
  if (!a) throw notFound('Agent');
  const voiceId = body.voiceId ?? a.elevenVoiceId;
  if (!elevenEnabled() || !voiceId) return res.status(204).setHeader('x-voice-fallback', 'browser').end();
  const b = await Business.findById(req.tenant!.businessId, { name: 1 }).lean();
  const audio = await elevenTts(body.text ?? `Hey, it’s ${a.name} from ${b?.name}. Quick heads-up, I’m an AI assistant on the sales team — did I catch you at an okay time?`, voiceId, { speed: a.speakingRate ?? 1 });
  res.setHeader('content-type', 'audio/mpeg');
  res.send(audio);
});

const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } });
/** Clone a voice from 1–5 short samples. Only the speaker (or someone they authorised) may do this. */
agentsRouter.post('/:id/voice-clone', requirePermission('agents:write'), audioUpload.array('samples', 5), async (req, res) => {
  if (!elevenEnabled()) throw badRequest('Voice cloning needs ELEVENLABS_API_KEY on the server');
  if (req.body?.consent !== 'true') throw badRequest('Confirm that this is your voice, or that you have the speaker’s written permission to clone it');
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw badRequest('Upload at least one clear voice sample (1–3 minutes total works best)');
  if (files.some((f) => !/^audio\//.test(f.mimetype) && !/\.(mp3|wav|m4a|ogg|webm)$/i.test(f.originalname))) throw badRequest('Samples must be audio files (MP3, WAV, M4A, OGG or WebM)');
  if (!can(req.auth!.role, 'agents:write')) throw forbidden();
  const a = await AIAgent.findOne({ ...scope(req), _id: req.params.id });
  if (!a) throw notFound('Agent');
  const name = String(req.body?.name || `${req.auth!.name} (cloned)`).slice(0, 60);
  const voiceId = await elevenClone(name, files.map((f) => ({ buffer: f.buffer, filename: f.originalname, mimetype: f.mimetype })), `Cloned for ${a.name} with speaker consent by ${req.auth!.email}`);
  a.set({ voiceProvider: 'elevenlabs', elevenVoiceId: voiceId, clonedVoice: { name, consentAt: new Date(), consentBy: req.auth!.userId } });
  await a.save();
  await audit(req, 'agent.voice_cloned', 'AI_Agent', a._id, { name, samples: files.length });
  res.json(a);
});
