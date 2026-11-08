import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { User, Business, TeamMember, AIAgent, Lead, Campaign, CampaignLead, Call, CallTranscript, Appointment, Activity, BusinessKnowledge, LeadSource } from '../models/index.js';
import { syncBusinessProfileKnowledge, indexDocument } from './knowledge/ingest.js';
import { ingestLeads } from './leads/discovery.js';
import { sandbox } from '../providers/leads/sandbox.js';
import { schedulerTick } from './campaigns/scheduler.js';
import { drain } from '../queue/queue.js';
import { clock } from '../lib/clock.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

export const DEMO_EMAIL = 'demo@dialstack.dev';
export const DEMO_PASSWORD = 'Demo1234!';

/**
 * Demo workspace for an India-based company selling to salons in the US and UK:
 * settings, knowledge, local caller IDs, two AI sales execs, two campaigns (one with daily auto-research)
 * and ~2 weeks of simulated calls replayed through the real scheduler, so outcomes and follow-ups are realistic.
 */
export async function seedDemo() {
  const existing = await User.findOne({ email: DEMO_EMAIL }).lean();
  if (existing) {
    const tm = await TeamMember.findOne({ userId: existing._id }).setOptions({ crossTenant: true }).lean();
    if (tm && (await Campaign.exists({ businessId: tm.businessId }))) { logger.info('demo workspace already exists'); return; }
    // An earlier start died half-way through seeding: clear the partial workspace and seed it again.
    logger.warn('found an unfinished demo workspace — recreating it');
    if (tm) {
      const mongoose = (await import('mongoose')).default;
      for (const m of Object.values(mongoose.models)) if (m.schema.path('businessId')) await (m as any).deleteMany({ businessId: tm.businessId }).setOptions({ crossTenant: true });
      await Business.deleteOne({ _id: tm.businessId });
    }
    await User.deleteMany({ email: { $in: [DEMO_EMAIL, 'priya.manager@dialstack.dev'] } });
  }
  const user = await User.create({ email: DEMO_EMAIL, name: 'Abbas Mhowwala', passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) });
  const business = await Business.create({
    name: 'GlowDesk', industry: 'Salon software', website: 'https://glowdesk.example.com', location: 'Pune, India (serving US & UK)', phone: '+1 512 555 0100',
    description: 'GlowDesk fills empty chairs for hair and beauty salons with online booking, automatic reminders and win-back texts. Salons on GlowDesk typically cut no-shows by 35% and rebook 20% more clients within 60 days.',
    products: [
      { name: 'GlowDesk Booking', description: '24/7 online booking on Instagram, Google and your website, synced with every stylist’s calendar', price: '$79 per month per location' },
      { name: 'GlowDesk Reminders & Win-back', description: 'Automatic text and email reminders, plus win-back campaigns for clients who haven’t visited in 60 days', price: '$49 per month' },
    ],
    services: [{ name: 'White-glove setup', description: 'We import your client list and services and train your front desk in one session', price: 'Free on annual plans' }],
    targetAudience: 'Independent hair salons, nail salons, barbershops and day spas with 2–25 chairs in the US and UK.',
    icp: { industries: ['Beauty & Personal Care', 'Retail'], roles: ['Owner', 'Salon Owner', 'Salon Manager', 'Founder'], keywords: ['hair salon', 'nail salon', 'online booking'], companySizes: ['1-10', '11-50'], budgetMin: 50, budgetMax: 400, currency: 'USD', requirements: 'Fewer no-shows, a fuller book, less time on the phone' },
    targetLocations: ['Austin, TX, USA', 'Miami, FL, USA', 'Los Angeles, CA, USA', 'London, UK'],
    targetCountries: ['USA', 'United Kingdom'],
    priorityRules: [
      { priority: 1, signal: 'no_website', label: 'No website or online booking at all' },
      { priority: 2, signal: 'no_online_booking', label: 'Has a website but no online booking' },
      { priority: 3, signal: 'has_online_booking', label: 'Already books online — offer a switch' },
    ],
    callerIds: [{ country: 'US', number: '+15125550100', label: 'Austin local' }, { country: 'GB', number: '+442079460000', label: 'London local' }],
    faqs: [
      { question: 'How much does GlowDesk cost?', answer: 'GlowDesk Booking is $79 a month per location, and Reminders & Win-back is $49 a month. Annual plans get two months free and free white-glove setup.' },
      { question: 'Is there a free trial?', answer: 'Yes — a 14-day free trial, no card needed.' },
      { question: 'Does it work with Instagram and Google?', answer: 'Yes. Clients can book straight from your Instagram profile and your Google Business listing.' },
      { question: 'Do you integrate with Square or Vagaro?', answer: 'We import clients from Square, Vagaro, Fresha and spreadsheets, and take payments through Stripe or Square.' },
      { question: 'Is there a contract?', answer: 'No long contracts — monthly plans can be cancelled any time.' },
    ],
    salesScripts: [{ name: 'Salon discovery', content: 'Ask how they book appointments today, how many no-shows they get a week, and how much an empty chair costs them. Position the 35% no-show reduction. Offer a 15-minute demo with a specialist.' }],
    goals: 'Book 60 demos a month with salons in Texas, Florida, California and London.',
    qualification: { hotThreshold: 70, warmThreshold: 40, requirePhone: true, autoApproveAbove: 0 },
    compliance: { timezone: 'America/New_York', callingWindowStart: '10:00', callingWindowEnd: '18:00', callingDays: [1, 2, 3, 4, 5, 6], recordCalls: true, requireConsentForRecording: true, maxAttemptsPerLead: 3 },
    followUps: { autoCallBack: true, autoNurture: true, nurtureDefaultDays: 45, dailyLimit: 50 },
    transferNumber: '+15125550199',
    onboardingComplete: true,
  });
  const businessId = business._id;
  await TeamMember.create({ businessId, userId: user._id, role: 'owner' });
  const mgr = await User.create({ email: 'priya.manager@dialstack.dev', name: 'Priya Nair', passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) });
  await TeamMember.create({ businessId, userId: mgr._id, role: 'manager' });
  const agent = await AIAgent.create({
    businessId, name: 'Sarah', isDefault: true, title: 'Senior Account Executive', style: 'natural', language: 'en-US',
    experience: '12 years selling software to salons and spas; built and closed a seven-figure book of business; known for consultative discovery and confident, no-pressure closes.',
    voice: 'Polly.Joanna-Neural', voiceProvider: 'elevenlabs', elevenVoiceId: 'EXAVITQu4vr4xnSDxMaL', speakingRate: 1,
    objective: 'Find out how the salon books and reminds clients today, and book a 15-minute GlowDesk demo.',
    objectionHandling: [
      { objection: 'too expensive costly price budget', response: 'Totally fair. Most salons cover it with the first two no-shows they prevent each month — and there’s a 14-day free trial, so you see it on your own numbers first.' },
      { objection: 'already have vagaro square booking system software', response: 'Makes sense — a lot of our salons came from Vagaro or Square. We import everything in one session, and the win-back texts alone usually pay for it.' },
    ],
  });
  await AIAgent.create({ businessId, name: 'Oliver', title: 'Account Executive, UK', style: 'natural', language: 'en-GB', voice: 'Polly.Amy-Neural', voiceProvider: 'elevenlabs', elevenVoiceId: 'JBFqnCBsd6RMkjVDRZzb', objective: 'Book a 15-minute GlowDesk demo with UK salon owners.' });
  await syncBusinessProfileKnowledge(business);
  const doc = await BusinessKnowledge.create({ businessId, title: 'GlowDesk onboarding & guarantees', type: 'manual', source: 'Manual entry', uploadedBy: user._id });
  await indexDocument(businessId, doc._id, 'Setup takes one 45-minute session. We import your clients, services and staff calendars, connect Instagram and Google booking, and train your front desk. Support is available 7 days a week by chat and phone, 8am to 8pm Eastern and UK time. If no-shows do not drop within 60 days, the next month is free.');

  const today = DateTime.now().setZone('America/New_York').startOf('day');
  const raws = await sandbox.discover({ keywords: ['hair salon', 'nail salon'], industries: ['Beauty & Personal Care'], locations: ['Austin, TX', 'Miami, FL', 'Los Angeles, CA', 'London, UK'], roles: ['Owner', 'Salon Owner'], companySizes: [], limit: 70 });
  const run = await LeadSource.create({ businessId, provider: 'sandbox', query: { keywords: ['hair salon', 'nail salon'], locations: business.targetLocations }, status: 'completed', startedAt: new Date(), finishedAt: new Date(), requestedBy: user._id });
  const r = await ingestLeads(business.toObject(), raws, 'sandbox', run._id, user._id, 'Salons');
  const { prioritizeLeads } = await import('./leads/priority.js');
  await prioritizeLeads(business.toObject(), r.createdIds);
  Object.assign(run, { found: r.found, created: r.created, duplicates: r.duplicates, rejected: r.rejected }); await run.save();
  const leads = await Lead.find({ businessId }).sort({ score: -1 });
  for (const [i, l] of leads.entries()) {
    const day = today.minus({ days: 14 - Math.floor((i / leads.length) * 14) }).plus({ hours: 9 + (i % 8) }).toJSDate();
    await Lead.collection.updateOne({ _id: l._id }, { $set: { createdAt: day } });
    await Activity.collection.updateMany({ leadId: l._id }, { $set: { createdAt: day } });
  }
  const approved = leads.slice(0, Math.round(leads.length * 0.75));
  await Lead.updateMany({ businessId, _id: { $in: approved.map((l) => l._id) } }, { approval: 'approved' });
  await Lead.updateMany({ businessId, _id: { $in: approved.slice(0, 10).map((l) => l._id) } }, { assignedTo: mgr._id });

  const us = approved.filter((l: any) => l.location?.country !== 'United Kingdom');
  const uk = approved.filter((l: any) => l.location?.country === 'United Kingdom');
  const campaign = await Campaign.create({
    businessId, name: 'US salons — Texas, Florida & California', category: 'Salons', agentId: agent._id, objective: 'getting more bookings and fewer no-shows at your salon',
    status: 'active', autoCalling: true, startedAt: today.minus({ days: 13 }).toJSDate(), createdBy: user._id, endDate: today.plus({ days: 30 }).toJSDate(),
    schedule: { timezone: 'America/New_York', days: [1, 2, 3, 4, 5, 6], startTime: '10:00', endTime: '18:00' }, maxRetries: 1, retryDelayMinutes: 60, dailyLimit: 5, maxConcurrent: 4,
    research: { enabled: true, provider: 'sandbox', keywords: ['hair salon', 'nail salon'], locations: ['Austin, TX', 'Miami, FL', 'Los Angeles, CA'], countries: ['USA'], frequency: 'daily', leadsPerRun: 10, autoApproveMinScore: 65, totalFound: r.created, totalAdded: us.length, nextRunAt: today.plus({ days: 1, hours: 9 }).toJSDate(), lastRunAt: today.plus({ hours: 9 }).toJSDate() },
  });
  const ukCampaign = await Campaign.create({
    businessId, name: 'London salons pilot', category: 'Salons', agentId: (await AIAgent.findOne({ businessId, name: 'Oliver' }))!._id, objective: 'online booking for your salon',
    status: 'active', autoCalling: true, startedAt: today.minus({ days: 6 }).toJSDate(), createdBy: user._id, endDate: today.plus({ days: 60 }).toJSDate(),
    schedule: { timezone: 'Europe/London', days: [1, 2, 3, 4, 5], startTime: '10:00', endTime: '17:00' }, maxRetries: 1, retryDelayMinutes: 90, dailyLimit: 3, maxConcurrent: 2,
    research: { enabled: false, frequency: 'weekly', keywords: ['hair salon'], locations: ['London, UK'], countries: ['United Kingdom'] },
  });
  const t0 = today.minus({ days: 14 }).toJSDate();
  await CampaignLead.insertMany(us.slice(0, 40).map((l) => ({ businessId, campaignId: campaign._id, leadId: l._id, status: 'queued', attempts: 0, nextAttemptAt: t0 })));
  await CampaignLead.insertMany(uk.slice(0, 12).map((l) => ({ businessId, campaignId: ukCampaign._id, leadId: l._id, status: 'queued', attempts: 0, nextAttemptAt: t0 })));

  // Replay 14 days of the real scheduler + simulator (US & UK business hours), back-dating what each slot produced.
  const speed = env.SIMULATOR_SPEED_MS;
  (env as any).SIMULATOR_SPEED_MS = 0;
  const research = await Campaign.find({ businessId, 'research.enabled': true }).lean();
  await Campaign.updateMany({ businessId }, { 'research.enabled': false }); // don't trigger new discovery during replay
  for (let d = 13; d >= 0; d--) {
    for (const [zone, hour] of [['Europe/London', 11], ['America/New_York', 11], ['America/New_York', 14], ['America/Los_Angeles', 13]] as const) {
      const at = DateTime.now().setZone(zone).startOf('day').minus({ days: d }).set({ hour, minute: 7 }).toJSDate();
      if (at > new Date()) continue;
      clock.set(at);
      const before = new Date();
      await schedulerTick(at);
      await drain();
      const backdate = async (Model: any) => {
        const docs = await Model.find({ businessId, createdAt: { $gte: before } }, { _id: 1 }).setOptions({ crossTenant: true }).lean();
        if (docs.length) await Model.collection.updateMany({ _id: { $in: docs.map((x: any) => x._id) } }, { $set: { createdAt: at } });
      };
      for (const M of [Call, CallTranscript, Appointment, Activity]) await backdate(M);
    }
  }
  clock.set(null);
  (env as any).SIMULATOR_SPEED_MS = speed;
  for (const c of research) await Campaign.updateOne({ businessId, _id: c._id }, { 'research.enabled': true });
  const wins = await Lead.find({ businessId, outcome: 'meeting' }).limit(2);
  for (const l of wins) { l.status = 'converted'; await l.save(); await Activity.create({ businessId, leadId: l._id, type: 'status_change', message: 'Status changed from meeting_scheduled to converted', userId: mgr._id }); }
  // Pause (not complete) campaigns that still have time left, so you can press Resume in the demo.
  // A second category so the lead picker shows grouping (fictional nonprofits, never in a campaign yet)
  const ngoRaws = await sandbox.discover({ keywords: ['nonprofit'], industries: ['Non-profit'], locations: ['Houston, Texas, USA', 'Chicago, Illinois, USA', 'Manchester, North West England, United Kingdom'], roles: ['Executive Director'], companySizes: [], limit: 10 });
  const ngoRun = await LeadSource.create({ businessId, provider: 'sandbox', category: 'NGO', query: { keywords: ['nonprofit'] }, status: 'completed', startedAt: new Date(), finishedAt: new Date(), requestedBy: user._id });
  const ngo = await ingestLeads(business.toObject(), ngoRaws, 'sandbox', ngoRun._id, user._id, 'NGO');
  await prioritizeLeads(business.toObject(), ngo.createdIds);
  await Lead.updateMany({ businessId, _id: { $in: ngo.createdIds } }, { approval: 'approved' });
  await Campaign.updateMany({ businessId, status: { $in: ['active', 'completed'] }, endDate: { $gt: new Date() } }, { status: 'paused', $unset: { completedAt: 1 } });
  logger.info({ email: DEMO_EMAIL, calls: await Call.countDocuments({ businessId }), leads: leads.length }, 'demo workspace seeded');
}
