import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User, Business, TeamMember, AIAgent } from '../models/index.js';
import { parse } from '../lib/validate.js';
import { badRequest, conflict, unauthorized, forbidden } from '../lib/errors.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { permissionsFor } from '../middleware/rbac.js';
import { audit } from '../services/audit.js';
import { sha256 } from '../lib/crypto.js';
import { syncBusinessProfileKnowledge } from '../services/knowledge/ingest.js';

export const authRouter = Router();

const password = z.string().min(8, 'Password must be at least 8 characters').max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter').regex(/[0-9]/, 'Password must contain a number');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(200),
  password,
  businessName: z.string().trim().min(2).max(120),
  industry: z.string().trim().max(80).optional(),
  website: z.string().trim().max(300).optional(),
});

async function sessionFor(userId: string, businessId?: string) {
  const memberships = await TeamMember.find({ userId, status: 'active' }).setOptions({ crossTenant: true }).lean();
  if (!memberships.length) throw forbidden('No active workspace for this account');
  const m = memberships.find((x) => String(x.businessId) === businessId) ?? memberships[0];
  const [user, business, businesses] = await Promise.all([
    User.findById(userId).lean(),
    Business.findById(m.businessId).lean(),
    Business.find({ _id: { $in: memberships.map((x) => x.businessId) } }, { name: 1 }).lean(),
  ]);
  const ctx = { userId: String(userId), businessId: String(m.businessId), role: m.role as any, email: user!.email, name: user!.name };
  return {
    token: signToken(ctx),
    user: { id: ctx.userId, name: ctx.name, email: ctx.email, role: ctx.role, permissions: permissionsFor(ctx.role) },
    business: { id: String(business!._id), name: business!.name, onboardingComplete: business!.onboardingComplete },
    businesses: businesses.map((b) => ({ id: String(b._id), name: b.name })),
  };
}

authRouter.post('/register', async (req, res) => {
  const body = parse(registerSchema, req.body);
  if (await User.exists({ email: body.email.toLowerCase() })) throw conflict('An account with this email already exists');
  const user = await User.create({ email: body.email, name: body.name, passwordHash: await bcrypt.hash(body.password, 12) });
  const business = await Business.create({ name: body.businessName, industry: body.industry, website: body.website });
  await TeamMember.create({ businessId: business._id, userId: user._id, role: 'owner' });
  await AIAgent.create({
    businessId: business._id, name: 'Aria', isDefault: true,
    openingLine: `Hi, this is Aria, an AI assistant calling on behalf of ${business.name}.`,
  });
  await syncBusinessProfileKnowledge(business).catch(() => undefined);
  await audit(null, 'auth.register', 'User', user._id, { email: user.email }, business._id);
  res.status(201).json(await sessionFor(String(user._id)));
});

authRouter.post('/login', async (req, res) => {
  const body = parse(z.object({ email: z.email(), password: z.string().min(1).max(200) }), req.body);
  const user = await User.findOne({ email: body.email.toLowerCase() }).select('+passwordHash');
  if (!user) throw unauthorized('Invalid email or password');
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new (await import('../lib/errors.js')).AppError(423, 'Account temporarily locked after too many failed attempts. Try again in 15 minutes.', 'LOCKED');
  const ok = await bcrypt.compare(body.password, user.passwordHash);
  if (!ok) {
    user.failedLogins = (user.failedLogins ?? 0) + 1;
    if (user.failedLogins >= 5) { user.lockedUntil = new Date(Date.now() + 15 * 60_000); user.failedLogins = 0; }
    await user.save();
    throw unauthorized('Invalid email or password');
  }
  user.failedLogins = 0; user.lockedUntil = undefined; user.lastLoginAt = new Date();
  await user.save();
  const session = await sessionFor(String(user._id));
  await audit(null, 'auth.login', 'User', user._id, {}, session.business.id);
  res.json(session);
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await sessionFor(req.auth!.userId, req.auth!.businessId));
});

authRouter.post('/switch', requireAuth, async (req, res) => {
  const { businessId } = parse(z.object({ businessId: z.string().length(24) }), req.body);
  const s = await sessionFor(req.auth!.userId, businessId);
  if (s.business.id !== businessId) throw forbidden('Not a member of that workspace');
  res.json(s);
});

authRouter.post('/accept-invite', async (req, res) => {
  const body = parse(z.object({ token: z.string().min(20), name: z.string().trim().min(2).max(80), password }), req.body);
  const member = await TeamMember.findOne({ inviteTokenHash: sha256(body.token), status: 'invited' }).setOptions({ crossTenant: true }).select('+inviteTokenHash');
  if (!member) throw badRequest('Invite link is invalid or has already been used');
  const user = await User.findById(member.userId).select('+passwordHash');
  if (!user) throw badRequest('Invite is no longer valid');
  user.name = body.name;
  user.passwordHash = await bcrypt.hash(body.password, 12);
  await user.save();
  member.status = 'active'; member.inviteTokenHash = undefined;
  await member.save();
  await audit(null, 'team.invite_accepted', 'TeamMember', member._id, {}, member.businessId);
  res.json(await sessionFor(String(user._id), String(member.businessId)));
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string(), newPassword: password }), req.body);
  const user = await User.findById(req.auth!.userId).select('+passwordHash');
  if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');
  user.passwordHash = await bcrypt.hash(body.newPassword, 12);
  await user.save();
  await audit(req, 'auth.password_changed', 'User', user._id);
  res.json({ ok: true });
});
