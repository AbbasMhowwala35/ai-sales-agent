import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  // Render (and similar hosts) provide the public URL; the UI is served from the same origin there.
  PUBLIC_BASE_URL: z.string().default(process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:4000'),
  CLIENT_ORIGIN: z.string().default(process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173'),
  MONGO_URI: z.string().optional(),
  USE_IN_MEMORY_DB: bool(false),

  JWT_SECRET: z.string().min(16).default('dev-only-change-me-jwt-secret-please'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  ENCRYPTION_KEY: z.string().default('dev-only-change-me-32-byte-encryption-key!!'),

  // AI providers
  LLM_PROVIDER: z.enum(['openai', 'local']).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  EMBEDDING_PROVIDER: z.enum(['openai', 'local']).optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  // Telephony / voice
  TELEPHONY_PROVIDER: z.enum(['twilio', 'vapi', 'simulator']).optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  TWILIO_VALIDATE_SIGNATURE: bool(true),
  VAPI_API_KEY: z.string().optional(),
  VAPI_PHONE_NUMBER_ID: z.string().optional(),
  VAPI_WEBHOOK_SECRET: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_MODEL: z.string().default('eleven_turbo_v2_5'),
  SIMULATOR_SPEED_MS: z.coerce.number().default(400),

  // Lead data providers
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  APOLLO_API_KEY: z.string().optional(),
  ENABLE_SANDBOX_LEADS: bool(true),

  // Email / calendar
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('AI Sales Agent <no-reply@example.com>'),
  GOOGLE_CALENDAR_CLIENT_ID: z.string().optional(),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALENDAR_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().default('primary'),

  // Storage
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  /** Max characters indexed per knowledge document — keeps memory bounded on small (512 MB) hosts. */
  MAX_DOC_CHARS: z.coerce.number().default(250_000),

  // Workers
  RUN_WORKERS: bool(true),
  QUEUE_POLL_MS: z.coerce.number().default(1000),
  SCHEDULER_TICK_MS: z.coerce.number().default(15000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(300),
  AUTH_RATE_LIMIT_PER_15MIN: z.coerce.number().default(30),
});

const parsed = schema.parse(process.env);

if (parsed.NODE_ENV === 'production') {
  if (parsed.JWT_SECRET.startsWith('dev-only') || parsed.ENCRYPTION_KEY.startsWith('dev-only')) {
    throw new Error('JWT_SECRET and ENCRYPTION_KEY must be set to strong secrets in production');
  }
}

export const env = {
  ...parsed,
  LLM_PROVIDER: parsed.LLM_PROVIDER ?? (parsed.OPENAI_API_KEY ? 'openai' : 'local'),
  EMBEDDING_PROVIDER: parsed.EMBEDDING_PROVIDER ?? (parsed.OPENAI_API_KEY ? 'openai' : 'local'),
  TELEPHONY_PROVIDER:
    parsed.TELEPHONY_PROVIDER ??
    (parsed.VAPI_API_KEY ? 'vapi' : parsed.TWILIO_ACCOUNT_SID ? 'twilio' : 'simulator'),
  isTest: parsed.NODE_ENV === 'test',
  isProd: parsed.NODE_ENV === 'production',
};

export type Env = typeof env;
