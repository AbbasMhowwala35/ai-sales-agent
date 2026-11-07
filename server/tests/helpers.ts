import mongoose from 'mongoose';
import request from 'supertest';
import { beforeAll, afterAll, afterEach } from 'vitest';
import { createApp } from '../src/app.js';
import { registerJobHandlers } from '../src/workers.js';
import { clock } from '../src/lib/clock.js';
import { setTelephony } from '../src/providers/telephony/index.js';

export const app = createApp();
registerJobHandlers();

export function useDb() {
  beforeAll(async () => {
    const uri = process.env.MONGO_TEST_URI!;
    const dbName = `t_${Math.random().toString(36).slice(2, 10)}`;
    await mongoose.connect(uri, { dbName });
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  });
  afterEach(() => { clock.set(null); setTelephony(null); });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}

let n = 0;
export async function register(overrides: Record<string, unknown> = {}) {
  n++;
  const body = { name: 'Asha Owner', email: `owner${n}_${Date.now()}@acme.test`, password: 'Passw0rd!', businessName: `Acme ${n}`, ...overrides };
  const res = await request(app).post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, businessId: res.body.business.id as string, userId: res.body.user.id as string, email: body.email as string };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
export const api = (token: string) => ({
  get: (u: string) => request(app).get(u).set(auth(token)),
  post: (u: string, b?: any) => request(app).post(u).set(auth(token)).send(b),
  patch: (u: string, b?: any) => request(app).patch(u).set(auth(token)).send(b),
  delete: (u: string) => request(app).delete(u).set(auth(token)),
});

/** A Monday at 11:00 IST — inside every default window (business, campaign, TRAI) for Indian numbers. */
export const BUSINESS_HOURS_IST = new Date('2026-11-09T05:30:00.000Z');
/** For +1 (US) sandbox numbers: Monday 11:00 New York, 21:30 IST. Use campaigns/business windows spanning the day. */
export const BUSINESS_HOURS_US = new Date('2026-11-09T16:00:00.000Z');

export const ICP_SETTINGS = {
  description: 'Acme builds CRM automation software that helps retail and healthcare businesses follow up with customers automatically.',
  industry: 'Software',
  products: [{ name: 'Acme CRM', description: 'Customer follow-up automation with WhatsApp and email', price: '₹4,999 per month' }],
  services: [{ name: 'Onboarding', description: 'White-glove data migration and training' }],
  targetAudience: 'Small and mid-sized retail stores and clinics',
  icp: { industries: ['Retail', 'Healthcare'], roles: ['Founder', 'Operations Head'], keywords: ['crm', 'customer follow-up'], companySizes: ['11-50', '51-200'] },
  targetLocations: ['Mumbai, India', 'Pune, India'],
  faqs: [
    { question: 'How much does Acme CRM cost?', answer: 'Acme CRM costs ₹4,999 per month per location, billed monthly, with a 14-day free trial.' },
    { question: 'Do you offer support?', answer: 'Yes, we provide 24x7 support over phone, chat and email in English and Hindi.' },
  ],
};
