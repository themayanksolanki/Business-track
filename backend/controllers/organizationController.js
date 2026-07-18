import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { getAccessibleDepartmentIds, canAccessDepartment } from '../utils/access.js';

const CREATABLE_ROLES = {
  Admin: ['Admin', 'Manager', 'Team Lead', 'User'],
  Manager: ['Team Lead', 'User'],
  'Team Lead': ['User'],
};

export const getMyOrganization = async (req, res, next) => {
  try {
    if (!req.user.organizationId) return next(new AppError('You are not part of an organization', 404));

    const organization = await prisma.organization.findUnique({ where: { id: req.user.organizationId } });
    if (!organization) return next(new AppError('Organization not found', 404));

    res.status(200).json(organization);
  } catch (err) {
    next(err);
  }
};

export const updateOrganization = async (req, res, next) => {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: req.user.organizationId } });
    if (!organization) return next(new AppError('Organization not found', 404));

    const { name, emailDomain } = req.body;
    const data = { updatedById: req.user.id };

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

export const getAdmins = async (req, res, next) => {
  try {
    const admins = await prisma.user.findMany({
      where: { organizationId: req.user.organizationId, role: 'Admin' },
      omit: { password: true },
    });
    res.status(200).json(admins);
  } catch (err) {
    next(err);
  }
};

export const createInvite = async (req, res, next) => {
  try {
    const { email, role, departments, managerId, teamLeadId } = req.body;

    const allowedRoles = CREATABLE_ROLES[req.user.role] ?? [];
    if (!allowedRoles.includes(role)) return next(new AppError(`You cannot invite a ${role}`, 403));

    const normalizedEmail = email.toLowerCase().trim();
    const organization = await prisma.organization.findUnique({ where: { id: req.user.organizationId } });
    if (!organization) return next(new AppError('Organization not found', 404));

    if (normalizedEmail.split('@')[1] !== organization.emailDomain)
      return next(new AppError('Invite email must belong to the organization email domain', 400));

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) return next(new AppError('A user with that email already exists', 409));

    const existingInvite = await prisma.invite.findFirst({
      where: { organizationId: organization.id, email: normalizedEmail, status: 'pending' },
    });
    if (existingInvite) return next(new AppError('An invite for that email is already pending', 409));

    let deptIds = [];
    if (Array.isArray(departments) && departments.length) {
      if (req.user.role !== 'Admin') {
        const accessibleIds = await getAccessibleDepartmentIds(req.user);
        const outOfScope = departments.some((id) => !canAccessDepartment(accessibleIds, id));
        if (outOfScope)
          return next(new AppError('You can only invite into departments within your scope', 403));
      }
      deptIds = departments.map(Number);
    }

    let resolvedManagerId = managerId ? Number(managerId) : null;
    let resolvedTeamLeadId = teamLeadId ? Number(teamLeadId) : null;

    if (req.user.role === 'Manager' && role === 'Team Lead' && !resolvedManagerId) {
      resolvedManagerId = req.user.id;
    }
    if (req.user.role === 'Team Lead' && role === 'User') {
      resolvedTeamLeadId = resolvedTeamLeadId ?? req.user.id;
      resolvedManagerId = resolvedManagerId ?? req.user.managerId ?? null;
    }

    const invite = await prisma.invite.create({
      data: {
        organizationId: organization.id,
        email: normalizedEmail,
        role,
        departments: { connect: deptIds.map((id) => ({ id })) },
        managerId: resolvedManagerId,
        teamLeadId: resolvedTeamLeadId,
        invitedById: req.user.id,
      },
    });

    res.status(201).json({ message: 'Invite created', invite });
  } catch (err) {
    next(err);
  }
};

export const getInvites = async (req, res, next) => {
  try {
    const where = { organizationId: req.user.organizationId, status: 'pending' };
    if (req.user.role !== 'Admin') where.invitedById = req.user.id;

    const invites = await prisma.invite.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.status(200).json(invites);
  } catch (err) {
    next(err);
  }
};

export const activateInvite = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    const invite = await prisma.invite.findUnique({
      where: { id: Number(req.params.id) },
      include: { departments: { select: { id: true } } },
    });
    if (!invite || invite.organizationId !== req.user.organizationId)
      return next(new AppError('Invite not found', 404));

    if (invite.status !== 'pending')
      return next(new AppError('This invite has already been accepted', 409));

    if (req.user.role !== 'Admin' && invite.invitedById !== req.user.id)
      return next(new AppError('You can only activate invites you created', 403));

    const existingUser = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existingUser) return next(new AppError('A user with that email already exists', 409));

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username: username.trim(),
        email: invite.email,
        password: hashedPassword,
        role: invite.role,
        organizationId: invite.organizationId,
        isActive: true,
        managerId: invite.managerId,
        teamLeadId: invite.teamLeadId,
        departments: { connect: invite.departments.map((d) => ({ id: d.id })) },
      },
      omit: { password: true },
    });

    await prisma.invite.update({ where: { id: invite.id }, data: { status: 'accepted' } });

    res.status(201).json({ message: `${user.username} has been activated`, user });
  } catch (err) {
    next(err);
  }
};

export const revokeInvite = async (req, res, next) => {
  try {
    const invite = await prisma.invite.findUnique({ where: { id: Number(req.params.id) } });
    if (!invite || invite.organizationId !== req.user.organizationId)
      return next(new AppError('Invite not found', 404));

    if (req.user.role !== 'Admin' && invite.invitedById !== req.user.id)
      return next(new AppError('You can only revoke invites you created', 403));

    await prisma.invite.delete({ where: { id: invite.id } });
    res.status(200).json({ message: 'Invite revoked' });
  } catch (err) {
    next(err);
  }
};
