import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { getAccessibleDepartmentIds, canAccessDepartment } from '../utils/access.js';
import { nextSequenceId } from '../utils/sequence.js';
import { sendInviteEmail } from '../utils/mailer.js';
import { generateAccessToken, generateRefreshToken, COOKIE_OPTIONS, toUserShape } from './authController.js';

export const CREATABLE_ROLES: Record<string, string[]> = {
  Admin: ['Admin', 'Manager', 'Team Lead', 'User'],
  Manager: ['Team Lead', 'User'],
  'Team Lead': ['User'],
};

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const buildInviteLink = (token: string) => {
  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:4200').split(',')[0].trim();
  return `${clientUrl}/accept-invite/${token}`;
};

export const getMyOrganization = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user!.organizationId) return next(new AppError('You are not part of an organization', 404));

    const organization = await prisma.organization.findUnique({ where: { id: req.user!.organizationId } });
    if (!organization) return next(new AppError('Organization not found', 404));

    res.status(200).json(organization);
  } catch (err) {
    next(err);
  }
};

export const updateOrganization = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: req.user!.organizationId! } });
    if (!organization) return next(new AppError('Organization not found', 404));

    const { name, emailDomain } = req.body;
    const data: Prisma.OrganizationUncheckedUpdateInput = { updatedById: req.user!.id };

    if (name !== undefined) {
      const existing = await prisma.organization.findFirst({
        where: { name: name.trim(), id: { not: organization.id } },
      });
      if (existing) return next(new AppError('Organization name already taken', 409));
      data.name = name.trim();
    }

    if (emailDomain !== undefined) {
      const normalizedDomain = emailDomain.toLowerCase().trim();
      const existing = await prisma.organization.findFirst({
        where: { emailDomain: normalizedDomain, id: { not: organization.id } },
      });
      if (existing) return next(new AppError('Organization email domain already registered', 409));
      data.emailDomain = normalizedDomain;
    }

    const updated = await prisma.organization.update({ where: { id: organization.id }, data });
    res.status(200).json({ message: 'Organization updated', organization: updated });
  } catch (err) {
    next(err);
  }
};

export const getAdmins = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admins = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, role: 'Admin' },
      omit: { password: true },
    });
    res.status(200).json(admins);
  } catch (err) {
    next(err);
  }
};

export const createInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, role, departments, managerId, teamLeadId } = req.body;

    const allowedRoles = CREATABLE_ROLES[req.user!.role] ?? [];
    if (!allowedRoles.includes(role)) return next(new AppError(`You cannot invite a ${role}`, 403));

    const normalizedEmail = email.toLowerCase().trim();
    const organization = await prisma.organization.findUnique({ where: { id: req.user!.organizationId! } });
    if (!organization) return next(new AppError('Organization not found', 404));

    if (normalizedEmail.split('@')[1] !== organization.emailDomain)
      return next(new AppError('Invite email must belong to the organization email domain', 400));

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) return next(new AppError('A user with that email already exists', 409));

    const existingInvite = await prisma.invite.findFirst({
      where: { organizationId: organization.id, email: normalizedEmail, status: 'pending' },
    });
    if (existingInvite) return next(new AppError('An invite for that email is already pending', 409));

    let deptIds: number[] = [];
    if (Array.isArray(departments) && departments.length) {
      if (req.user!.role !== 'Admin') {
        const accessibleIds = await getAccessibleDepartmentIds(req.user!);
        const outOfScope = departments.some((id: number | string) => !canAccessDepartment(accessibleIds, id));
        if (outOfScope)
          return next(new AppError('You can only invite into departments within your scope', 403));
      }
      deptIds = departments.map(Number);
    }

    let resolvedManagerId = managerId ? Number(managerId) : null;
    let resolvedTeamLeadId = teamLeadId ? Number(teamLeadId) : null;

    if (req.user!.role === 'Manager' && role === 'Team Lead' && !resolvedManagerId) {
      resolvedManagerId = req.user!.id;
    }
    if (req.user!.role === 'Team Lead' && role === 'User') {
      resolvedTeamLeadId = resolvedTeamLeadId ?? req.user!.id;
      resolvedManagerId = resolvedManagerId ?? req.user!.managerId ?? null;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);

    const invite = await prisma.invite.create({
      data: {
        organizationId: organization.id,
        email: normalizedEmail,
        role,
        departments: { connect: deptIds.map((id) => ({ id })) },
        managerId: resolvedManagerId,
        teamLeadId: resolvedTeamLeadId,
        invitedById: req.user!.id,
        token,
        tokenExpiresAt,
      },
    });

    sendInviteEmail(normalizedEmail, role, organization.name, buildInviteLink(token)).catch(() => {});

    res.status(201).json({ message: 'Invite created', invite });
  } catch (err) {
    next(err);
  }
};

export const getInvites = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const where: Prisma.InviteWhereInput = { organizationId: req.user!.organizationId!, status: 'pending' };
    if (req.user!.role !== 'Admin') where.invitedById = req.user!.id;

    const invites = await prisma.invite.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.status(200).json(invites);
  } catch (err) {
    next(err);
  }
};

export const activateInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;

    const invite = await prisma.invite.findUnique({
      where: { id: Number(req.params.id) },
      include: { departments: { select: { id: true } } },
    });
    if (!invite || invite.organizationId !== req.user!.organizationId)
      return next(new AppError('Invite not found', 404));

    if (invite.status !== 'pending')
      return next(new AppError('This invite has already been accepted', 409));

    if (req.user!.role !== 'Admin' && invite.invitedById !== req.user!.id)
      return next(new AppError('You can only activate invites you created', 403));

    const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existingUser) return next(new AppError('A user with that email already exists', 409));

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const sequenceId = await nextSequenceId(tx, invite.organizationId, 'user');
      const created = await tx.user.create({
        data: {
          username: username.trim(),
          email: invite.email,
          password: hashedPassword,
          role: invite.role,
          organizationId: invite.organizationId,
          sequenceId,
          isActive: true,
          managerId: invite.managerId,
          teamLeadId: invite.teamLeadId,
          departments: { connect: invite.departments.map((d) => ({ id: d.id })) },
        },
        omit: { password: true },
      });

      await tx.invite.update({ where: { id: invite.id }, data: { status: 'accepted' } });

      return created;
    });

    res.status(201).json({ message: `${user.username} has been activated`, user });
  } catch (err) {
    next(err);
  }
};

// Public — looked up by the emailed accept-invite link, before the invitee
// has any account/session of their own.
export const getInviteByToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invite = await prisma.invite.findUnique({
      where: { token: req.params.token as string },
      include: { organization: { select: { name: true } } },
    });
    if (!invite) return next(new AppError('Invite not found', 404));
    if (invite.status !== 'pending') return next(new AppError('This invite has already been accepted', 409));
    if (!invite.tokenExpiresAt || invite.tokenExpiresAt < new Date())
      return next(new AppError('This invite link has expired', 410));

    res.status(200).json({
      email: invite.email,
      role: invite.role,
      organizationName: invite.organization.name,
    });
  } catch (err) {
    next(err);
  }
};

// Public — the invitee sets their own username/password from the emailed
// link, unlike activateInvite() above (which requires the *inviter* to be
// logged in and choose the password on the invitee's behalf).
export const acceptInviteByToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;

    const invite = await prisma.invite.findUnique({
      where: { token: req.params.token as string },
      include: { departments: { select: { id: true } } },
    });
    if (!invite) return next(new AppError('Invite not found', 404));
    if (invite.status !== 'pending') return next(new AppError('This invite has already been accepted', 409));
    if (!invite.tokenExpiresAt || invite.tokenExpiresAt < new Date())
      return next(new AppError('This invite link has expired', 410));

    const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existingUser) return next(new AppError('A user with that email already exists', 409));

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const sequenceId = await nextSequenceId(tx, invite.organizationId, 'user');
      const created = await tx.user.create({
        data: {
          username: username.trim(),
          email: invite.email,
          password: hashedPassword,
          role: invite.role,
          organizationId: invite.organizationId,
          sequenceId,
          isActive: true,
          managerId: invite.managerId,
          teamLeadId: invite.teamLeadId,
          departments: { connect: invite.departments.map((d) => ({ id: d.id })) },
        },
        include: { organization: { select: { id: true, name: true, emailDomain: true } } },
      });

      await tx.invite.update({
        where: { id: invite.id },
        data: { status: 'accepted', token: null, tokenExpiresAt: null },
      });

      return created;
    });

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);
    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

    res.status(201).json({
      message: `Welcome to ${user.organization!.name}!`,
      token: accessToken,
      refreshToken,
      user: toUserShape(user),
    });
  } catch (err) {
    next(err);
  }
};

export const revokeInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invite = await prisma.invite.findUnique({ where: { id: Number(req.params.id) } });
    if (!invite || invite.organizationId !== req.user!.organizationId)
      return next(new AppError('Invite not found', 404));

    if (req.user!.role !== 'Admin' && invite.invitedById !== req.user!.id)
      return next(new AppError('You can only revoke invites you created', 403));

    await prisma.invite.delete({ where: { id: invite.id } });
    res.status(200).json({ message: 'Invite revoked' });
  } catch (err) {
    next(err);
  }
};
