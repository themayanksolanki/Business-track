import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { sendPasswordChangedEmail } from '../utils/mailer.js';
import { canManageRole, getAccessibleDepartmentIds } from '../utils/access.js';
import { CREATABLE_ROLES } from './organizationController.js';
import { enqueueUserDeactivation } from '../queues/userDeactivationQueue.js';

const sameOrg = (a: number | null | undefined, b: number | null | undefined) => (a ?? null) === (b ?? null);

export const getAllUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const where: Prisma.UserWhereInput = { isActive: true, organizationId: req.user!.organizationId };

    if (req.user!.role === 'Manager') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user!);
      where.departments = { some: { id: { in: accessibleIds ?? [] } } };
    }

    const departmentsInclude = { departments: { select: { id: true, name: true, color: true, depth: true } } };

    if (req.query.page === undefined) {
      const users = await prisma.user.findMany({ where, omit: { password: true }, include: departmentsInclude });
      return res.status(200).json(users);
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 12));
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        omit: { password: true },
        include: departmentsInclude,
        orderBy: { username: 'asc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.status(200).json({
      users,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const getTeamLeads = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamLeads = await prisma.user.findMany({
      where: { role: 'Team Lead', isActive: true, organizationId: req.user!.organizationId },
      omit: { password: true },
    });
    res.status(200).json(teamLeads);
  } catch (err) {
    next(err);
  }
};

export const getTeamMembers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const members = await prisma.user.findMany({
      where: { teamLeadId: req.user!.id, role: 'User', isActive: true, organizationId: req.user!.organizationId },
      omit: { password: true },
    });
    res.status(200).json(members);
  } catch (err) {
    next(err);
  }
};

export const getPendingUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const where: Prisma.UserWhereInput = { isActive: false, organizationId: req.user!.organizationId };

    if (req.user!.role === 'Admin') {
      // org-wide
    } else if (req.user!.role === 'Manager') {
      where.managerId = req.user!.id;
    } else if (req.user!.role === 'Team Lead') {
      where.teamLeadId = req.user!.id;
    } else {
      return res.status(200).json([]);
    }

    const users = await prisma.user.findMany({ where, omit: { password: true } });
    res.status(200).json(users);
  } catch (err) {
    next(err);
  }
};

export const activateUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!target || !sameOrg(target.organizationId, req.user!.organizationId))
      return next(new AppError('User not found', 404));

    const currentRole = req.user!.role;
    const targetRole = target.role;

    const canActivate =
      canManageRole(currentRole, targetRole) &&
      (currentRole === 'Admin' ||
        (currentRole === 'Manager' && target.managerId === req.user!.id) ||
        (currentRole === 'Team Lead' && target.teamLeadId === req.user!.id));

    if (!canActivate)
      return next(new AppError('You do not have permission to activate this user', 403));

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { isActive: true },
      omit: { password: true },
    });

    res.status(200).json({ message: `${updated.username} has been activated`, user: updated });
  } catch (err) {
    next(err);
  }
};

export const deactivateUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reassignToId } = req.body;

    const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!target || !sameOrg(target.organizationId, req.user!.organizationId))
      return next(new AppError('User not found', 404));

    if (target.id === req.user!.id)
      return next(new AppError('You cannot deactivate your own account', 400));

    if (!canManageRole(req.user!.role, target.role))
      return next(new AppError('You do not have permission to deactivate this user', 403));

    let handler = null;
    if (reassignToId) {
      handler = await prisma.user.findUnique({ where: { id: Number(reassignToId) } });
      if (!handler || !sameOrg(handler.organizationId, req.user!.organizationId) || !handler.isActive)
        return next(new AppError('Reassignment target not found', 404));
      if (handler.id === target.id)
        return next(new AppError('Cannot reassign work to the user being deactivated', 400));
    }

    // Deactivation is a soft, reversible disable (isActive: false) — it never
    // deletes the User row, so historical authorship (createdBy/comments/
    // messages) is left untouched. Only *current, open* work — assigned
    // tasks/items, owned projects, and project memberships — is handed off to
    // the chosen handler, so nothing is silently left pointing at a disabled
    // account.
    if (!handler) {
      // Nothing to reassign (getReassignableWork already told the frontend
      // this) — no reason to queue an empty job, deactivate immediately.
      const updated = await prisma.user.update({
        where: { id: target.id },
        data: { isActive: false },
        omit: { password: true },
      });
      return res.status(200).json({ message: `${updated.username} has been deactivated`, user: updated });
    }

    // Reassignment work runs as a background job (see
    // workers/userDeactivationWorker.js, which has the actual transaction
    // logic — reassign tasks/items/projects/memberships, then flip
    // isActive) so this request returns immediately instead of waiting on
    // it; the target isn't deactivated yet at this point. req.user.id gets
    // notified in-app once the job completes or exhausts its retries.
    await enqueueUserDeactivation({ targetId: target.id, handlerId: handler.id, actorId: req.user!.id });

    res.status(202).json({
      message: `Deactivation queued for ${target.username} — you'll be notified when it's done`,
      queued: true,
    });
  } catch (err) {
    next(err);
  }
};

export const getReassignableWork = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!target || !sameOrg(target.organizationId, req.user!.organizationId))
      return next(new AppError('User not found', 404));

    const [assignedTasks, assignedProjectItems, ownedProjects, projectMemberships] = await Promise.all([
      prisma.task.count({ where: { assignedToId: target.id } }),
      prisma.projectItem.count({ where: { assignedToId: target.id } }),
      prisma.project.count({ where: { ownerId: target.id } }),
      prisma.projectMember.count({ where: { userId: target.id } }),
    ]);

    res.status(200).json({ assignedTasks, assignedProjectItems, ownedProjects, projectMemberships });
  } catch (err) {
    next(err);
  }
};

export const updateUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, email, role, managerId, teamLeadId } = req.body;

    const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!target || !sameOrg(target.organizationId, req.user!.organizationId))
      return next(new AppError('User not found', 404));

    if (!canManageRole(req.user!.role, target.role))
      return next(new AppError('You do not have permission to edit this user', 403));

    const data: Prisma.UserUncheckedUpdateInput = {};

    if (username !== undefined) {
      data.username = username.trim();
    }

    if (email !== undefined) {
      const normalizedEmail = email.toLowerCase().trim();
      if (normalizedEmail !== target.email) {
        if (req.user!.organizationId) {
          const organization = await prisma.organization.findUnique({ where: { id: req.user!.organizationId } });
          if (organization && normalizedEmail.split('@')[1] !== organization.emailDomain)
            return next(new AppError('Email must belong to the organization email domain', 400));
        }
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) return next(new AppError('A user with that email already exists', 409));
        data.email = normalizedEmail;
      }
    }

    if (role !== undefined && role !== target.role) {
      const allowedRoles = CREATABLE_ROLES[req.user!.role] ?? [];
      if (!allowedRoles.includes(role) || !canManageRole(req.user!.role, role))
        return next(new AppError(`You cannot assign the ${role} role`, 403));
      data.role = role;
    }

    if (managerId !== undefined) {
      if (managerId === null) {
        data.managerId = null;
      } else {
        const manager = await prisma.user.findUnique({ where: { id: Number(managerId) } });
        if (!manager || !sameOrg(manager.organizationId, req.user!.organizationId))
          return next(new AppError('Manager not found', 404));
        data.managerId = manager.id;
      }
    }

    if (teamLeadId !== undefined) {
      if (teamLeadId === null) {
        data.teamLeadId = null;
      } else {
        const teamLead = await prisma.user.findUnique({ where: { id: Number(teamLeadId) } });
        if (!teamLead || !sameOrg(teamLead.organizationId, req.user!.organizationId))
          return next(new AppError('Team Lead not found', 404));
        data.teamLeadId = teamLead.id;
      }
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data,
      omit: { password: true },
    });

    res.status(200).json({ message: `${updated.username} updated`, user: updated });
  } catch (err) {
    next(err);
  }
};

export const updateUserPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6)
      return next(new AppError('Password must be at least 6 characters', 400));

    const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!target || !sameOrg(target.organizationId, req.user!.organizationId))
      return next(new AppError('User not found', 404));

    const callerRole = req.user!.role;
    const targetRole = target.role;

    const allowed =
      canManageRole(callerRole, targetRole) &&
      (callerRole === 'Admin' ||
        callerRole === 'Manager' ||
        (callerRole === 'Team Lead' && target.teamLeadId === req.user!.id));

    if (!allowed)
      return next(new AppError('You do not have permission to update this password', 403));

    await prisma.user.update({
      where: { id: target.id },
      data: { password: await bcrypt.hash(password, 10) },
    });

    sendPasswordChangedEmail(target.email, target.username, password).catch(() => {});

    res.status(200).json({ message: `Password updated for ${target.username}` });
  } catch (err) {
    next(err);
  }
};

export const updateUserDepartments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { departmentIds } = req.body;

    const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!target || !sameOrg(target.organizationId, req.user!.organizationId))
      return next(new AppError('User not found', 404));

    const uniqueIds: number[] = [...new Set(departmentIds.map(Number))] as number[];

    if (req.user!.role === 'Manager') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user!);
      const outOfScope = uniqueIds.some((id) => !(accessibleIds ?? []).includes(id));
      if (outOfScope)
        return next(new AppError('You can only assign departments within your own scope', 403));
    }

    const count = await prisma.department.count({
      where: { id: { in: uniqueIds }, organizationId: req.user!.organizationId },
    });
    if (count !== uniqueIds.length)
      return next(new AppError('One or more departments were not found', 404));

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { departments: { set: uniqueIds.map((id) => ({ id })) } },
      omit: { password: true },
      include: { departments: { select: { id: true, name: true, color: true, depth: true } } },
    });

    res.status(200).json({ message: `Departments updated for ${updated.username}`, user: updated });
  } catch (err) {
    next(err);
  }
};
