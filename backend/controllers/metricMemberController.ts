import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { canAccessMetric, canManageMetricMembers } from './metricController.js';

type AuthUser = { id: number; role: string; organizationId: number | null };

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };
const MEMBER_INCLUDE = { user: { select: USER_SELECT } };

// Backs the Team tab's "Add Member" dropdown — paginated, searchable,
// org-scoped, excludes users already on the team. Mirrors
// projectMemberController.ts's getMemberCandidates exactly, scoped to
// Metric instead of Project.
export const getMemberCandidates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = await prisma.metric.findUnique({
      where: { id: Number(req.params.metricId) },
      include: { members: { select: { userId: true, role: true } } },
    });
    if (!metric) return next(new AppError('Metric not found', 404));
    if (!(await canAccessMetric(req.user! as AuthUser, metric)))
      return next(new AppError('You do not have access to this metric', 403));
    if (!canManageMetricMembers(req.user! as AuthUser, metric))
      return next(new AppError('You do not have permission to manage members of this metric', 403));

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      isActive: true,
      organizationId: req.user!.organizationId,
      id: { notIn: metric.members.map((m) => m.userId) },
    };

    const search = ((req.query.search as string) ?? '').trim();
    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

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

export const getMembers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = await prisma.metric.findUnique({
      where: { id: Number(req.params.metricId) },
      include: { members: { include: MEMBER_INCLUDE, orderBy: { addedAt: 'asc' } } },
    });
    if (!metric) return next(new AppError('Metric not found', 404));
    if (!(await canAccessMetric(req.user! as AuthUser, metric)))
      return next(new AppError('You do not have access to this metric', 403));

    res.status(200).json(metric.members);
  } catch (err) {
    next(err);
  }
};

export const addMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = await prisma.metric.findUnique({
      where: { id: Number(req.params.metricId) },
      include: { members: { select: { userId: true, role: true } } },
    });
    if (!metric) return next(new AppError('Metric not found', 404));
    if (!(await canAccessMetric(req.user! as AuthUser, metric)))
      return next(new AppError('You do not have access to this metric', 403));
    if (!canManageMetricMembers(req.user! as AuthUser, metric))
      return next(new AppError('You do not have permission to manage members of this metric', 403));

    const userId = Number(req.body.userId);
    const role = req.body.role;

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser || !targetUser.isActive || targetUser.organizationId !== req.user!.organizationId)
      return next(new AppError('User not found', 404));

    if (metric.members.some((m) => m.userId === userId))
      return next(new AppError('This user is already on the team', 409));

    await prisma.metricMember.create({
      data: { metricId: metric.id, userId, role, addedById: req.user!.id },
    });

    const members = await prisma.metricMember.findMany({
      where: { metricId: metric.id },
      include: MEMBER_INCLUDE,
      orderBy: { addedAt: 'asc' },
    });

    res.status(201).json({ message: 'Member added', members });
  } catch (err) {
    next(err);
  }
};

export const updateMemberRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = await prisma.metric.findUnique({
      where: { id: Number(req.params.metricId) },
      include: { members: { select: { userId: true, role: true } } },
    });
    if (!metric) return next(new AppError('Metric not found', 404));
    if (!(await canAccessMetric(req.user! as AuthUser, metric)))
      return next(new AppError('You do not have access to this metric', 403));
    if (!canManageMetricMembers(req.user! as AuthUser, metric))
      return next(new AppError('You do not have permission to manage members of this metric', 403));

    const member = await prisma.metricMember.findUnique({ where: { id: Number(req.params.memberId) } });
    if (!member || member.metricId !== metric.id) return next(new AppError('Member not found', 404));

    const role = req.body.role;

    await prisma.metricMember.update({ where: { id: member.id }, data: { role } });

    const members = await prisma.metricMember.findMany({
      where: { metricId: metric.id },
      include: MEMBER_INCLUDE,
      orderBy: { addedAt: 'asc' },
    });

    res.status(200).json({ message: 'Member role updated', members });
  } catch (err) {
    next(err);
  }
};

export const removeMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = await prisma.metric.findUnique({
      where: { id: Number(req.params.metricId) },
      include: { members: { select: { userId: true, role: true } } },
    });
    if (!metric) return next(new AppError('Metric not found', 404));
    if (!(await canAccessMetric(req.user! as AuthUser, metric)))
      return next(new AppError('You do not have access to this metric', 403));
    if (!canManageMetricMembers(req.user! as AuthUser, metric))
      return next(new AppError('You do not have permission to manage members of this metric', 403));

    const member = await prisma.metricMember.findUnique({ where: { id: Number(req.params.memberId) } });
    if (!member || member.metricId !== metric.id) return next(new AppError('Member not found', 404));

    await prisma.metricMember.delete({ where: { id: member.id } });

    const members = await prisma.metricMember.findMany({
      where: { metricId: metric.id },
      include: MEMBER_INCLUDE,
      orderBy: { addedAt: 'asc' },
    });

    res.status(200).json({ message: 'Member removed', members });
  } catch (err) {
    next(err);
  }
};
