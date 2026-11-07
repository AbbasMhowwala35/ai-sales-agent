import mongoose, { Schema, type Model } from 'mongoose';
import { tenantPlugin } from '../lib/tenant.js';
import { encrypt, decrypt, blindIndex } from '../lib/crypto.js';
import { maskPhone } from '../lib/phone.js';
import { clock } from '../lib/clock.js';

const { ObjectId } = Schema.Types;
/** Models are loosely typed: request payloads are validated with zod at the API edge and by mongoose at runtime. */
const model = (name: string, schema: Schema, collection?: string) => mongoose.model(name, schema, collection) as unknown as Model<any>;
const opts = { timestamps: true, toJSON: { getters: true, virtuals: false, versionKey: false }, toObject: { getters: true } } as const;
const encField = { type: String, set: (v: string) => encrypt(v), get: (v: string) => decrypt(v) };

export const ROLES = ['owner', 'admin', 'manager', 'agent', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const LEAD_STATUSES = ['new', 'qualified', 'contacted', 'interested', 'meeting_scheduled', 'converted', 'lost'] as const;
export const CALL_RESULTS = ['answered', 'missed', 'busy', 'failed', 'voicemail'] as const;

/* ------------------------------- Users ------------------------------- */
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    lastLoginAt: Date,
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
  },
  opts,
);
userSchema.set('toJSON', { transform: (_d, r: any) => { delete r.passwordHash; return r; } });
export const User = model('User', userSchema);

/* ----------------------------- Businesses ---------------------------- */
const businessSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    industry: String,
    website: String,
    location: String,
    description: String,
    phone: String,
    products: [{ name: String, description: String, price: String, _id: false }],
    services: [{ name: String, description: String, price: String, _id: false }],
    targetAudience: String,
    icp: {
      industries: [String],
      companySizes: [String],
      roles: [String],
      keywords: [String],
      budgetMin: Number,
      budgetMax: Number,
      currency: { type: String, default: 'INR' },
      requirements: String,
    },
    targetLocations: [String],
    faqs: [{ question: String, answer: String, _id: false }],
    salesScripts: [{ name: String, content: String, _id: false }],
    goals: String,
    qualification: {
      hotThreshold: { type: Number, default: 70 },
      warmThreshold: { type: Number, default: 40 },
      requirePhone: { type: Boolean, default: true },
      autoApproveAbove: { type: Number, default: 0 }, // 0 = always manual approval
      criteria: String,
    },
    compliance: {
      timezone: { type: String, default: 'Asia/Kolkata' },
      callingWindowStart: { type: String, default: '10:00' },
      callingWindowEnd: { type: String, default: '19:00' },
      callingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] }, // 0=Sun
      recordCalls: { type: Boolean, default: true },
      recordingConsentMessage: { type: String, default: 'This call may be recorded for quality and training purposes.' },
      requireConsentForRecording: { type: Boolean, default: true },
      maxAttemptsPerLead: { type: Number, default: 3 },
      honorRegistryDnc: { type: Boolean, default: true },
    },
    transferNumber: String,
    /** Local presence: one outbound caller ID per destination country (E.164). */
    callerIds: [{ country: String, number: String, vapiPhoneNumberId: String, label: String, _id: false }],
    targetCountries: { type: [String], default: [] },
    /** Who needs us most: first matching rule (lowest priority number) wins. */
    priorityRules: [{
      priority: { type: Number, min: 1, max: 3 },
      label: String,
      signal: { type: String, enum: ['no_website', 'weak_website', 'good_website', 'no_online_booking', 'has_online_booking', 'not_mobile_friendly', 'no_https', 'outdated_website', 'keyword_present', 'keyword_absent', 'any'] },
      value: String,
      _id: false,
    }],
    googleCalendar: { email: String, refreshToken: encField, calendarId: { type: String, default: 'primary' }, connectedAt: Date, connectedBy: { type: ObjectId, ref: 'User' } },
    followUps: {
      autoCallBack: { type: Boolean, default: true },        // call back automatically at the time the prospect asked
      autoNurture: { type: Boolean, default: true },         // re-call "not now" prospects when their follow-up date arrives
      nurtureDefaultDays: { type: Number, default: 45 },     // when they say "later" without a date
      dailyLimit: { type: Number, default: 50 },
    },
    onboardingComplete: { type: Boolean, default: false },
  },
  opts,
);
export const Business = model('Business', businessSchema);

/* ---------------------------- Team members --------------------------- */
const teamMemberSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, default: 'agent' },
    status: { type: String, enum: ['active', 'invited', 'disabled'], default: 'active' },
    invitedBy: { type: ObjectId, ref: 'User' },
    inviteTokenHash: { type: String, select: false },
  },
  opts,
);
teamMemberSchema.plugin(tenantPlugin);
teamMemberSchema.index({ businessId: 1, userId: 1 }, { unique: true });
export const TeamMember = model('TeamMember', teamMemberSchema);

/* -------------------------- Knowledge base --------------------------- */
const knowledgeSchema = new Schema(
  {
    title: { type: String, required: true },
    type: { type: String, enum: ['pdf', 'docx', 'txt', 'md', 'csv', 'website', 'faq', 'script', 'profile', 'manual'], required: true },
    source: String,
    status: { type: String, enum: ['pending', 'processing', 'ready', 'failed'], default: 'pending' },
    error: String,
    charCount: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },
    contentHash: String,
    rawText: { type: String, select: false },
    storageKey: String,
    system: { type: Boolean, default: false }, // auto-generated from business settings
    uploadedBy: { type: ObjectId, ref: 'User' },
  },
  opts,
);
knowledgeSchema.plugin(tenantPlugin);
export const BusinessKnowledge = model('BusinessKnowledge', knowledgeSchema);

const chunkSchema = new Schema(
  {
    documentId: { type: ObjectId, ref: 'BusinessKnowledge', required: true, index: true },
    position: Number,
    text: { type: String, required: true },
    embedding: { type: [Number], required: true },
    embeddingModel: String,
    title: String,
  },
  { timestamps: true },
);
chunkSchema.plugin(tenantPlugin);
export const KnowledgeChunk = model('KnowledgeChunk', chunkSchema);

/* ------------------------------ AI agents ---------------------------- */
const agentSchema = new Schema(
  {
    name: { type: String, required: true },
    persona: { type: String, default: 'a friendly, professional sales development representative' },
    language: { type: String, default: 'en-IN' },
    voice: { type: String, default: 'Polly.Joanna-Neural' },
    voiceProvider: { type: String, enum: ['twilio', 'elevenlabs'], default: 'twilio' },
    elevenVoiceId: String,           // ElevenLabs premade or cloned voice
    clonedVoice: { name: String, consentAt: Date, consentBy: { type: ObjectId, ref: 'User' }, _id: false },
    title: { type: String, default: 'Senior Account Executive' },
    experience: { type: String, default: '12 years in B2B sales; consistently a top closer on seven-figure books of business.' },
    style: { type: String, enum: ['natural', 'formal'], default: 'natural' },
    tone: { type: String, enum: ['professional', 'friendly', 'enthusiastic', 'calm', 'consultative'], default: 'friendly' },
    speakingRate: { type: Number, default: 1 },
    objective: { type: String, default: 'Qualify interest and book a meeting with a sales representative.' },
    openingLine: String,
    instructions: String,
    objectionHandling: [{ objection: String, response: String, _id: false }],
    maxCallMinutes: { type: Number, default: 8 },
    transferNumber: String,
    isDefault: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  opts,
);
agentSchema.plugin(tenantPlugin);
export const AIAgent = model('AI_Agent', agentSchema, 'ai_agents');

/* -------------------------------- Leads ------------------------------ */
const leadSchema = new Schema(
  {
    companyName: { type: String, required: true, trim: true },
    contactName: String,
    designation: String,
    email: encField,
    emailHash: { type: String, index: true },
    phone: encField,
    phoneHash: { type: String, index: true },
    phoneMasked: String,
    website: String,
    domain: { type: String, index: true },
    location: { address: String, city: String, state: String, country: String, _id: false },
    industry: String,
    companySize: String,
    description: String,
    source: { type: String, required: true },
    sourceRef: String,
    discoveryRunId: { type: ObjectId, ref: 'LeadSource' },
    score: { type: Number, default: 0 },
    scoreBreakdown: [{ factor: String, points: Number, reason: String, _id: false }],
    temperature: { type: String, enum: ['hot', 'warm', 'cold'], default: 'cold' },
    status: { type: String, enum: LEAD_STATUSES, default: 'new', index: true },
    approval: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    assignedTo: { type: ObjectId, ref: 'User' },
    tags: [String],
    consent: { type: String, enum: ['unknown', 'granted', 'revoked'], default: 'unknown' },
    doNotCall: { type: Boolean, default: false },
    timezone: String,
    lastContactedAt: Date,
    nextFollowUpAt: Date,
    /** What the prospect actually wants, from the latest conversation. */
    category: { type: String, index: true },
    priority: { type: Number, min: 1, max: 3, index: true },
    priorityReason: String,
    websiteAudit: {
      checkedAt: Date, hasWebsite: Boolean, reachable: Boolean, score: Number, https: Boolean, mobileFriendly: Boolean,
      onlineBooking: Boolean, contactForm: Boolean, copyrightYear: Number, platform: String, issues: [String], _id: false,
    },
    brief: {
      summary: String, pains: [String], offered: [String], wants: [String], objections: [String], talkingPoints: [String],
      budget: String, timeline: String, quotes: [String], updatedAt: Date, callId: { type: ObjectId, ref: 'Call' }, _id: false,
    },
    outcome: { type: String, enum: ['none', 'meeting', 'interested', 'callback', 'nurture', 'busy', 'no_answer', 'not_interested', 'do_not_call'], default: 'none', index: true },
    outcomeNote: String,
    outcomeAt: Date,
    followUpAt: { type: Date, index: true },
    followUpQueuedAt: Date,
    lastAgentId: { type: ObjectId, ref: 'AI_Agent' },
    campaignId: { type: ObjectId, ref: 'Campaign' },
    dedupeKey: { type: String },
  },
  opts,
);
leadSchema.plugin(tenantPlugin);
leadSchema.index({ businessId: 1, dedupeKey: 1 }, { unique: true, sparse: true });
leadSchema.index({ businessId: 1, companyName: 'text', contactName: 'text' }, { language_override: 'textSearchLanguage' });
leadSchema.pre('validate', function (this: any) {
  const phone = this.phone as string | undefined;
  const email = this.email as string | undefined;
  this.phoneHash = blindIndex(phone);
  this.emailHash = blindIndex(email);
  this.phoneMasked = phone ? maskPhone(phone) : undefined;
});
export const Lead = model('Lead', leadSchema);

/* ----------------------- Lead discovery runs ------------------------- */
const leadSourceSchema = new Schema(
  {
    provider: { type: String, required: true },
    query: { type: Schema.Types.Mixed },
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued' },
    found: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    duplicates: { type: Number, default: 0 },
    rejected: { type: Number, default: 0 },
    error: String,
    startedAt: Date,
    finishedAt: Date,
    requestedBy: { type: ObjectId, ref: 'User' },
    campaignId: { type: ObjectId, ref: 'Campaign' },
    category: String,
    added: { type: Number, default: 0 },
  },
  opts,
);
leadSourceSchema.plugin(tenantPlugin);
export const LeadSource = model('LeadSource', leadSourceSchema);

/* ------------------------- Activity & reminders ---------------------- */
const activitySchema = new Schema(
  {
    leadId: { type: ObjectId, ref: 'Lead', required: true, index: true },
    type: { type: String, enum: ['created', 'note', 'status_change', 'approval', 'assignment', 'call', 'appointment', 'reminder', 'email', 'opt_out', 'score'], required: true },
    message: String,
    meta: Schema.Types.Mixed,
    userId: { type: ObjectId, ref: 'User' },
  },
  opts,
);
activitySchema.plugin(tenantPlugin);
export const Activity = model('Activity', activitySchema);

const reminderSchema = new Schema(
  {
    leadId: { type: ObjectId, ref: 'Lead', required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    dueAt: { type: Date, required: true, index: true },
    note: String,
    done: { type: Boolean, default: false },
    notified: { type: Boolean, default: false },
  },
  opts,
);
reminderSchema.plugin(tenantPlugin);
export const Reminder = model('Reminder', reminderSchema);

/* ------------------------------ Campaigns ---------------------------- */
const campaignSchema = new Schema(
  {
    name: { type: String, required: true },
    category: { type: String, index: true },
    description: String,
    agentId: { type: ObjectId, ref: 'AI_Agent', required: true },
    objective: String,
    script: String,
    status: { type: String, enum: ['draft', 'active', 'paused', 'completed'], default: 'draft', index: true },
    autoCalling: { type: Boolean, default: true },
    schedule: {
      timezone: { type: String, default: 'Asia/Kolkata' },
      days: { type: [Number], default: [1, 2, 3, 4, 5] },
      startTime: { type: String, default: '10:00' },
      endTime: { type: String, default: '18:00' },
    },
    maxRetries: { type: Number, default: 2, min: 0, max: 10 },
    retryDelayMinutes: { type: Number, default: 120, min: 1 },
    dailyLimit: { type: Number, default: 100, min: 1 },
    maxConcurrent: { type: Number, default: 3, min: 1, max: 50 },
    startedAt: Date,
    completedAt: Date,
    dispatchLockUntil: Date, // lease so only one scheduler dispatches a campaign at a time
    endDate: Date,
    /** How the agent pitches this campaign — worked out by the agent (LLM-tailored when available). */
    salesProfile: { type: Schema.Types.Mixed },
    /** Daily/weekly/monthly automatic prospect research feeding this campaign until endDate. */
    research: {
      enabled: { type: Boolean, default: false },
      provider: { type: String, default: 'auto' },
      keywords: [String],
      industries: [String],
      locations: [String],
      countries: [String],
      roles: [String],
      frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'daily' },
      leadsPerRun: { type: Number, default: 25 },
      autoApproveMinScore: { type: Number, default: 60 },
      lastRunAt: Date,
      nextRunAt: Date,
      totalFound: { type: Number, default: 0 },
      totalAdded: { type: Number, default: 0 },
    },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  opts,
);
campaignSchema.plugin(tenantPlugin);
export const Campaign = model('Campaign', campaignSchema);

const campaignLeadSchema = new Schema(
  {
    campaignId: { type: ObjectId, ref: 'Campaign', required: true, index: true },
    leadId: { type: ObjectId, ref: 'Lead', required: true },
    status: { type: String, enum: ['queued', 'calling', 'completed', 'retry', 'exhausted', 'skipped'], default: 'queued', index: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: () => clock.now() },
    lastCallId: { type: ObjectId, ref: 'Call' },
    lastResult: String,
    skipReason: String,
  },
  opts,
);
campaignLeadSchema.plugin(tenantPlugin);
campaignLeadSchema.index({ campaignId: 1, leadId: 1 }, { unique: true });
export const CampaignLead = model('CampaignLead', campaignLeadSchema);

/* -------------------------------- Calls ------------------------------ */
const callSchema = new Schema(
  {
    leadId: { type: ObjectId, ref: 'Lead', required: true, index: true },
    campaignId: { type: ObjectId, ref: 'Campaign', index: true },
    campaignLeadId: { type: ObjectId, ref: 'CampaignLead' },
    agentId: { type: ObjectId, ref: 'AI_Agent' },
    direction: { type: String, enum: ['outbound', 'inbound', 'test'], default: 'outbound' },
    provider: String,
    providerCallId: { type: String, index: true },
    toNumber: encField,
    fromNumber: String,
    status: { type: String, enum: ['queued', 'ringing', 'in_progress', 'ended'], default: 'queued', index: true },
    result: { type: String, enum: CALL_RESULTS },
    attempt: { type: Number, default: 1 },
    queuedAt: { type: Date, default: () => clock.now(), index: true },
    startedAt: Date,
    answeredAt: Date,
    endedAt: Date,
    durationSec: { type: Number, default: 0 },
    endReason: String,
    recordingId: { type: ObjectId, ref: 'CallRecording' },
    transcriptId: { type: ObjectId, ref: 'CallTranscript' },
    summary: String,
    sentiment: { label: { type: String, enum: ['positive', 'neutral', 'negative'] }, score: Number },
    qualification: {
      interested: Boolean,
      intent: { type: String, enum: ['high', 'medium', 'low', 'none'] },
      requirements: [String],
      budget: String,
      timeline: String,
      score: Number,
      _id: false,
    },
    keyPoints: [String],
    objections: [String],
    nextAction: String,
    appointmentId: { type: ObjectId, ref: 'Appointment' },
    transferred: { type: Boolean, default: false },
    optOut: { type: Boolean, default: false },
    recordingConsent: { type: Boolean },
    analysisStatus: { type: String, enum: ['pending', 'done', 'failed', 'skipped'], default: 'pending' },
    /** Sales-manager style review of the call: score, grade and a coaching tip per missed step. */
    scorecard: { type: Schema.Types.Mixed },
    errorMessage: String,
    state: { type: Schema.Types.Mixed, select: false }, // live conversation state (turn-based providers)
  },
  opts,
);
callSchema.plugin(tenantPlugin);
callSchema.index({ businessId: 1, createdAt: -1 });
export const Call = model('Call', callSchema);

const recordingSchema = new Schema(
  {
    callId: { type: ObjectId, ref: 'Call', required: true, index: true },
    storageKey: String,
    providerUrl: encField,
    mimeType: { type: String, default: 'audio/mpeg' },
    sizeBytes: Number,
    durationSec: Number,
    status: { type: String, enum: ['pending', 'available', 'failed'], default: 'pending' },
    error: String,
  },
  opts,
);
recordingSchema.plugin(tenantPlugin);
export const CallRecording = model('CallRecording', recordingSchema);

const transcriptSchema = new Schema(
  {
    callId: { type: ObjectId, ref: 'Call', required: true, index: true },
    language: String,
    segments: [{ speaker: { type: String, enum: ['agent', 'customer', 'system'] }, text: String, start: Number, end: Number, _id: false }],
    fullText: String,
  },
  opts,
);
transcriptSchema.plugin(tenantPlugin);
transcriptSchema.index({ businessId: 1, fullText: 'text' }, { language_override: 'textSearchLanguage', default_language: 'english' });
export const CallTranscript = model('CallTranscript', transcriptSchema);

/* ----------------------------- Appointments -------------------------- */
const appointmentSchema = new Schema(
  {
    leadId: { type: ObjectId, ref: 'Lead', required: true },
    callId: { type: ObjectId, ref: 'Call' },
    type: { type: String, enum: ['meeting', 'callback', 'demo'], default: 'meeting' },
    title: String,
    startsAt: { type: Date, required: true },
    endsAt: Date,
    timezone: String,
    status: { type: String, enum: ['scheduled', 'completed', 'cancelled', 'no_show'], default: 'scheduled' },
    notes: String,
    attendeeEmail: String,
    calendarEventId: String,
    meetLink: String,
    with: { type: String, enum: ['owner', 'specialist'], default: 'specialist' },
    assignedTo: { type: ObjectId, ref: 'User' },
  },
  opts,
);
appointmentSchema.plugin(tenantPlugin);
export const Appointment = model('Appointment', appointmentSchema);

/* ---------------------------- Notifications -------------------------- */
const notificationSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User' }, // null = everyone in the business
    type: { type: String, default: 'info' },
    title: String,
    message: String,
    link: String,
    readBy: [{ type: ObjectId, ref: 'User' }],
  },
  opts,
);
notificationSchema.plugin(tenantPlugin);
export const Notification = model('Notification', notificationSchema);

/* ---------------------- Compliance: Do-Not-Call ---------------------- */
const dncSchema = new Schema(
  {
    phoneHash: { type: String, required: true },
    phoneMasked: String,
    reason: { type: String, enum: ['opt_out', 'manual', 'registry', 'complaint'], default: 'manual' },
    source: String,
    addedBy: { type: ObjectId, ref: 'User' },
  },
  opts,
);
dncSchema.plugin(tenantPlugin);
dncSchema.index({ businessId: 1, phoneHash: 1 }, { unique: true });
export const DncEntry = model('DncEntry', dncSchema);

/* ------------------------------ Audit logs --------------------------- */
const auditSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User' },
    action: { type: String, required: true },
    entity: String,
    entityId: String,
    ip: String,
    meta: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.plugin(tenantPlugin);
export const AuditLog = model('AuditLog', auditSchema);

/* ------------------------------ Job queue ---------------------------- */
const jobSchema = new Schema(
  {
    type: { type: String, required: true, index: true },
    businessId: { type: ObjectId, ref: 'Business' },
    payload: Schema.Types.Mixed,
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued' },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    runAt: { type: Date, default: () => new Date() },
    lockedAt: Date,
    lockedBy: String,
    lastError: String,
    uniqueKey: { type: String },
    completedAt: Date,
  },
  { timestamps: true },
);
jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ uniqueKey: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['queued', 'running'] }, uniqueKey: { $type: 'string' } } });
export const Job = model('Job', jobSchema);

