import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { sendPasswordChangedEmail } from '../utils/mailer.js';
import { canManageRole, getAccessibleDepartmentIds } from '../utils/access.js';

const sameOrg = (a, b) => (a ?? null) === (b ?? null);

export const getAllUsers = async (req, res, next) => {
  try {
    const where = { isActive: true, organizationId: req.user.organizationId };

    if (req.user.role === 'Manager') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      where.departments = { some: { id: { in: accessibleIds } } };
    }

    if (req.query.page === undefined) {
      const users = await prisma.user.findMany({ where, omit: { password: true } });
      return res.status(200).json(users);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        omit: { password: true },
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

export const getTeamLeads = async (req, res, next) => {
  try {
    const teamLeads = await prisma.user.findMany({
      where: { role: 'Team Lead', isActive: true, organizationId: req.user.organizationId },
      omit: { password: true },
    });
    res.status(200).json(teamLeads);
  } catch (err) {
    next(err);
  }
};

export const getTeamMembers = async (req, res, next) => {
  try {
    const members = await prisma.user.findMany({
      where: { teamLeadId: req.user.id, role: 'User', isActive: true, organizationId: req.user.organizationId },
      omit: { password: true },
    });
    res.status(200).json(members);
  } catch (err) {
    next(err);
  }
};

export const getPendingUsers = async (req, res, next) => {
  try {
    const where = { isActive: false, organizationId: req.user.organizationId };

    if (req.user.role === 'Admin') {
      // org-wide
    } else if (req.user.role === 'Manager') {
      where.managerId = req.user.id;
    } else if (req.user.role === 'Team Lead') {
      where.teamLeadId = req.user.id;
    } else {
      return res.status(200).json([]);
    }

    const users = await prisma.user.findMany({ where, omit: { password: true } });
    res.status(200).json(users);
  } catch (err) {
    next(err);
  }
};

export const activateUser = async (req, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!target || !sameOrg(target.organizationId, req.user.organizationId))
      return next(new AppError('User not found', 404));

    const currentRole = req.user.role;
    const targetRole = target.role;

    const canActivate =
      canManageRole(currentRole, targetRole) &&
      (currentRole === 'Admin' ||
        (currentRole === 'Manager' && target.managerId === req.user.id) ||
        (currentRole === 'Team Lead' && target.teamLeadId === req.user.id));

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

export const deactivateUser = async (req, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!target || !sameOrg(target.organizationId, req.user.organizationId))
      return next(new AppError('User not found', 404));

    if (target.id === req.user.id)
      return next(new AppError('You cannot deactivate your own account', 400));

    if (!canManageRole(req.user.role, target.role))
      return next(new AppError('You do not have permission to deactivate this user', 403));

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { isActive: false },
      omit: { password: true },
    });

    res.status(200).json({ message: `${updated.username} has been deactivated`, user: updated });
  } catch (err) {
    next(err);
  }
};

export const updateUserPassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6)
      return next(new AppError('Password must be at least 6 characters', 400));

    const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!target || !sameOrg(target.organizationId, req.user.organizationId))
      return next(new AppError('User not found', 404));

    const callerRole = req.user.role;
    const targetRole = target.role;

    const allowed =
      canManageRole(callerRole, targetRole) &&
      (callerRole === 'Admin' ||
        callerRole === 'Manager' ||
        (callerRole === 'Team Lead' && target.teamLeadId === req.user.id));

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

export const updateUserDepartments = async (req, res, next) => {
  try {
    const { departmentIds } = req.body;

    const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!target || !sameOrg(target.organizationId, req.user.organizationId))
      return next(new AppError('User not found', 404));

    const uniqueIds = [...new Set(departmentIds.map(Number))];

    if (req.user.role === 'Manager') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      const outOfScope = uniqueIds.some((id) => !accessibleIds.includes(id));
      if (outOfScope)
        return next(new AppError('You can only assign departments within your own scope', 403));
    }

    const count = await prisma.department.count({
      where: { id: { in: uniqueIds }, organizationId: req.user.organizationId },
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
