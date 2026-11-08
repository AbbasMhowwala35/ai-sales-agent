import { Router } from 'express';
import { brandName } from '../lib/brand.js';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { TeamMember, User, ROLES, Business } from '../models/index.js';
import { parse } from '../lib/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { requirePermission, PERMISSIONS } from '../middleware/rbac.js';
import { scope } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { sendEmail } from '../providers/email/index.js';
import { env } from '../config/env.js';

export const teamRouter = Router();

teamRouter.get('/', async (req, res) => {
  const members = await TeamMember.find(scope(req)).populate('userId', 'name email lastLoginAt').sort({ createdAt: 1 }).lean();
  res.json({
    members: members.map((m: any) => ({ id: m._id, userId: m.userId?._id, name: m.userId?.name, email: m.userId?.email, lastLoginAt: m.userId?.lastLoginAt, role: m.role, status: m.status, createdAt: m.createdAt })),
    roles: ROLES,
    permissions: PERMISSIONS,
  });
});

teamRouter.post('/invite', requirePermission('team:manage'), async (req, res) => {
  const body = parse(z.object({ email: z.email(), name: z.string().trim().min(1).max(80).optional(), role: z.enum(ROLES).default('agent') }), req.body);
  if (body.role === 'owner' && req.auth!.role !== 'owner') throw forbidden('Only owners can invite owners');
  let user = await User.findOne({ email: body.email.toLowerCase() });
  if (!user) user = await User.create({ email: body.email, name: body.name ?? body.email.split('@')[0], passwordHash: await bcrypt.hash(randomToken(), 10) });
  if (await TeamMember.exists({ ...scope(req), userId: user._id })) throw conflict('This person is already a member');
  const token = randomToken(24);
  const member = await TeamMember.create({ ...scope(req), userId: user._id, role: body.role, status: 'invited', invitedBy: req.auth!.userId, inviteTokenHash: sha256(token) });
  const business = await Business.findById(req.tenant!.businessId, { name: 1 }).lean();
  const link = `${env.CLIENT_ORIGIN}/accept-invite?token=${token}`;
  await sendEmail({ to: user.email, subject: `You're invited to ${brandName(business)} on AI Sales Agent`, text: `${req.auth!.name} invited you as ${body.role}. Accept: ${link}` });
  await audit(req, 'team.invited', 'TeamMember', member._id, { email: user.email, role: body.role });
  // inviteLink is returned so admins can share it manually when SMTP isn't configured
  res.status(201).json({ id: member._id, email: user.email, role: member.role, status: member.status, inviteLink: link });
});

teamRouter.patch('/:id', requirePermission('team:manage'), async (req, res) => {
  const body = parse(z.object({ role: z.enum(ROLES).optional(), status: z.enum(['active', 'disabled']).optional() }), req.body);
  const m = await TeamMember.findOne({ ...scope(req), _id: req.params.id });
  if (!m) throw notFound('Member');
  if (String(m.userId) === req.auth!.userId) throw badRequest('You cannot change your own role or status');
  if ((m.role === 'owner' || body.role === 'owner') && req.auth!.role !== 'owner') throw forbidden('Only owners can manage owners');
  if (body.role) m.role = body.role;
  if (body.status && m.status !== 'invited') m.status = body.status;
  await m.save();
  await audit(req, 'team.updated', 'TeamMember', m._id, body);
  res.json({ id: m._id, role: m.role, status: m.status });
});

teamRouter.delete('/:id', requirePermission('team:manage'), async (req, res) => {
  const m = await TeamMember.findOne({ ...scope(req), _id: req.params.id });
  if (!m) throw notFound('Member');
  if (String(m.userId) === req.auth!.userId) throw badRequest('You cannot remove yourself');
  if (m.role === 'owner') {
    const owners = await TeamMember.countDocuments({ ...scope(req), role: 'owner', status: 'active' });
    if (owners <= 1) throw badRequest('A workspace must keep at least one owner');
  }
  await TeamMember.deleteOne({ ...scope(req), _id: m._id });
  await audit(req, 'team.removed', 'TeamMember', m._id);
  res.status(204).end();
});
