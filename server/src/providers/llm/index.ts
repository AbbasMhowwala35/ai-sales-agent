import { env } from '../../config/env.js';
import { fetchWithRetry, jsonOrThrow, isAccountError } from '../http.js';
import { logger } from '../../lib/logger.js';

export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: any; name?: string }
export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export interface ChatResult { content: string; toolCalls: { id: string; name: string; arguments: any }[] }

export interface LLMProvider {
  name: string;
  chat(messages: ChatMessage[], opts?: { json?: boolean; temperature?: number; maxTokens?: number; tools?: ToolDef[] }): Promise<ChatResult>;
}

/** OpenAI-compatible Chat Completions provider (works with OpenAI, Azure-compatible gateways, Groq, Together, etc.). */
export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  constructor(private apiKey: string, private model = env.OPENAI_MODEL, private baseUrl = env.OPENAI_BASE_URL) {}
  async chat(messages: ChatMessage[], opts: { json?: boolean; temperature?: number; maxTokens?: number; tools?: ToolDef[] } = {}): Promise<ChatResult> {
    const body: any = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 600,
    };
    if (opts.json) body.response_format = { type: 'json_object' };
    if (opts.tools?.length) body.tools = opts.tools.map((t) => ({ type: 'function', function: t }));
    const res = await fetchWithRetry(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      timeoutMs: 45_000,
    });
    let data: any;
    try { data = await jsonOrThrow(res, 'OpenAI'); } catch (e) {
      // No credits / bad key: stop calling OpenAI for the rest of this run; the agent uses its built-in sales engine.
      if (isAccountError(e)) { logger.warn('OpenAI chat unavailable (no credits or invalid key) — switching to the built-in sales engine'); setLLM(null); }
      throw e;
    }
    const msg = data.choices?.[0]?.message ?? {};
    return {
      content: msg.content ?? '',
      toolCalls: (msg.tool_calls ?? []).map((tc: any) => ({ id: tc.id, name: tc.function.name, arguments: safeJson(tc.function.arguments) })),
    };
  }
}

export function safeJson(s: string) {
  try { return JSON.parse(s); } catch { const m = s?.match?.(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { /* */ } } return {}; }
}

let cached: LLMProvider | null | undefined;
/** Returns the configured LLM, or null when running in local/offline mode (services then use deterministic heuristics). */
export function getLLM(): LLMProvider | null {
  if (cached !== undefined) return cached;
  cached = env.LLM_PROVIDER === 'openai' && env.OPENAI_API_KEY ? new OpenAIProvider(env.OPENAI_API_KEY) : null;
  return cached;
}
export function setLLM(p: LLMProvider | null) { cached = p; }
