import { Router } from 'express';
import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AIAgent, Business, Campaign } from '../models/index.js';
import { env } from '../config/env.js';
import { parse } from '../lib/validate.js';
import { notFound, unauthorized } from '../lib/errors.js';
import { start, respond, newState, type ConversationState } from '../services/agent/engine.js';
import { elevenEnabled, elevenTts } from '../providers/voice/elevenlabs.js';
import { brandName } from '../lib/brand.js';

/**
 * Public voice demo: a shareable, expiring link where anyone can talk to an agent in the browser (speech in,
 * voice out) — free, no phone line. Same sales engine as real calls. The token only grants this one agent's demo.
 */
export const demoRouter = Router();
demoRouter.use(express.json({ limit: '100kb' }));

export function demoToken(businessId: string, agentId: string, campaignId?: string) {
  return jwt.sign({ typ: 'demo', b: businessId, a: agentId, c: campaignId }, env.JWT_SECRET, { expiresIn: '14d', issuer: 'ai-sales-agent' });
}
function readToken(t: string) {
  try {
    const p = jwt.verify(t, env.JWT_SECRET, { issuer: 'ai-sales-agent' }) as any;
    if (p.typ !== 'demo') throw new Error('wrong type');
    return p as { b: string; a: string; c?: string };
  } catch { throw unauthorized('This demo link has expired or is invalid — ask for a new one'); }
}
async function load(token: string) {
  const p = readToken(token);
  const [agent, business, campaign] = await Promise.all([
    AIAgent.findOne({ businessId: p.b, _id: p.a }).lean(),
    Business.findById(p.b).lean(),
    p.c ? Campaign.findOne({ businessId: p.b, _id: p.c }).lean() : null,
  ]);
  if (!agent || !business) throw notFound('Demo');
  return { agent, business, campaign };
}

demoRouter.get('/:token', async (req, res) => {
  const { agent, business, campaign } = await load(req.params.token);
  res.json({ agentName: agent.name, brand: brandName(business), language: agent.language ?? 'en-US', category: (campaign as any)?.category ?? null, naturalVoice: elevenEnabled() && !!agent.elevenVoiceId });
});

demoRouter.post('/:token/chat', async (req, res) => {
  const body = parse(z.object({ message: z.string().max(600).optional(), state: z.any().optional(), name: z.string().trim().max(40).optional() }), req.body ?? {});
  const { agent, business, campaign } = await load(req.params.token);
  const cat = (campaign as any)?.category;
  const lead = { contactName: body.name || '', companyName: cat ? `your ${cat.replace(/s$/i, '').toLowerCase()} business` : 'your business', designation: 'Owner', category: cat };
  const ctx = { business, agent, lead, campaign: campaign ?? undefined };
  if (!body.message || !body.state) { const s = start(ctx as any); return res.json({ reply: s.reply, state: s.state, end: false, actions: [] }); }
  const state: ConversationState = { ...newState(), ...(body.state as object) };
  res.json(await respond(ctx as any, state, body.message));
});

/** Natural voice when ElevenLabs is configured; otherwise 204 → the browser speaks with its own voice (free). */
demoRouter.post('/:token/voice', async (req, res) => {
  const body = parse(z.object({ text: z.string().trim().min(1).max(400) }), req.body ?? {});
  const { agent } = await load(req.params.token);
  if (!elevenEnabled() || !agent.elevenVoiceId) return res.status(204).setHeader('x-voice-fallback', 'browser').end();
  const audio = await elevenTts(body.text, agent.elevenVoiceId, { speed: agent.speakingRate ?? 1 });
  res.setHeader('content-type', 'audio/mpeg');
  res.send(audio);
});
