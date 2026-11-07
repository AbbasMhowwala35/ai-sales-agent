import { env } from '../../config/env.js';
import { fetchWithRetry, jsonOrThrow } from '../http.js';
import type { TelephonyProvider, DialRequest } from './types.js';
import { openingMessage, systemPrompt, newState } from '../../services/agent/engine.js';

/**
 * Vapi voice AI (streaming STT → LLM → TTS with barge-in). We pass a transient assistant built from the
 * business + agent config. Vapi calls our tool endpoints for knowledge retrieval / booking / opt-out and
 * posts status + end-of-call reports (transcript, recording URL) to /api/webhooks/vapi.
 */
export const vapi: TelephonyProvider = {
  id: 'vapi',
  async dial(req: DialRequest) {
    const ctx = { business: req.business, agent: req.agent, lead: req.lead, campaign: req.campaign };
    const server = { url: `${env.PUBLIC_BASE_URL}/api/webhooks/vapi`, ...(env.VAPI_WEBHOOK_SECRET ? { secret: env.VAPI_WEBHOOK_SECRET } : {}) };
    const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } }, server });
    const body = {
      phoneNumberId: req.vapiPhoneNumberId ?? env.VAPI_PHONE_NUMBER_ID,
      customer: { number: req.to, name: req.lead?.contactName?.slice(0, 40) },
      metadata: { callId: req.callId, businessId: req.businessId },
      assistant: {
        name: req.agent?.name ?? 'Sales Agent',
        firstMessage: openingMessage(ctx),
        firstMessageMode: 'assistant-speaks-first',
        model: {
          provider: 'openai', model: env.OPENAI_MODEL, temperature: 0.5,
          messages: [{ role: 'system', content: systemPrompt(ctx, newState(), 'Use the search_knowledge_base tool for any product, pricing or policy question.').replace(/Respond ONLY as JSON[\s\S]*$/, 'Reply in plain spoken sentences.') }],
          tools: [
            tool('search_knowledge_base', 'Look up facts about our products, services, pricing and policies.', { query: { type: 'string' } }, ['query']),
            tool('book_meeting', 'Book a meeting or callback once the prospect agrees on a time.', { time_text: { type: 'string', description: "Prospect's words for the time, e.g. 'tomorrow 3pm'" }, kind: { type: 'string', enum: ['meeting', 'callback'] } }, ['time_text']),
            tool('mark_do_not_call', 'Prospect asked not to be called again. Call this, then politely end the call.', {}),
          ],
        },
        voice: req.agent?.voiceProvider === 'elevenlabs' && req.agent?.elevenVoiceId
          ? { provider: '11labs', voiceId: req.agent.elevenVoiceId, model: env.ELEVENLABS_MODEL, stability: 0.38, similarityBoost: 0.8, style: 0.25, useSpeakerBoost: true, speed: req.agent?.speakingRate ?? 1, fillerInjectionEnabled: true }
          : { provider: 'azure', voiceId: req.agent?.language === 'en-GB' ? 'en-GB-SoniaNeural' : 'en-US-JennyNeural', speed: req.agent?.speakingRate ?? 1 },
        backgroundSound: 'office',
        backchannelingEnabled: true,
        transcriber: { provider: 'deepgram', model: 'nova-2', language: (req.agent?.language ?? 'en-US').split('-')[0] },
        endCallFunctionEnabled: true,
        maxDurationSeconds: (req.agent?.maxCallMinutes ?? 8) * 60,
        voicemailDetection: { provider: 'twilio' },
        artifactPlan: { recordingEnabled: req.record },
        ...(req.agent?.transferNumber || req.business?.transferNumber ? { forwardingPhoneNumber: req.agent?.transferNumber || req.business?.transferNumber } : {}),
        server,
        serverMessages: ['status-update', 'end-of-call-report', 'tool-calls'],
      },
    };
    const res = await fetchWithRetry('https://api.vapi.ai/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.VAPI_API_KEY}` },
      body: JSON.stringify(body),
    });
    const data = await jsonOrThrow(res, 'Vapi');
    return { providerCallId: data.id };
  },
  async hangup(id: string) {
    await fetchWithRetry(`https://api.vapi.ai/call/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.VAPI_API_KEY}` }, body: JSON.stringify({ status: 'ended' }) }).catch(() => undefined);
  },
};
