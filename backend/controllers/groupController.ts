import type { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { nextSequenceId } from '../utils/sequence.js';
import { notifyUsers } from '../utils/notifications.js';
import { cloudinary } from '../middleware/upload.js';

// Extract Cloudinary public_id from a secure URL for deletion — same small
// helper as authController.ts's updateAvatar/removeAvatar, not worth sharing
// for 3 lines.
const getPublicId = (url: string | null | undefined) => {
  const match = url?.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z]+)?$/i);
  return match?.[1] ?? null;
};

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };
const MEMBER_INCLUDE = { user: { select: USER_SELECT } };

const GROUP_INCLUDE = {
  members: { include: MEMBER_INCLUDE, orderBy: { joinedAt: 'asc' as const } },
  createdBy: { select: USER_SELECT },
};

type AuthUser = { id: number; role: string; organizationId: number | null };

interface GroupForAccess {
  organizationId: number | null;
  members: { userId: number }[];
}

// Same-org Admin, or an actual member — mirrors canAccessMeeting/canAccessProject's
// "Admin always sees everything in their org" convention.
export const canAccessGroup = (user: AuthUser, group: GroupForAccess) => {
  if (group.organizationId !== user.organizationId) return false;
  if (user.role === 'Admin') return true;
  return group.members.some((m) => m.userId === user.id);
};

export const canManageGroup = (
  user: AuthUser,
  group: { createdById: number },
  members: { userId: number; role: string }[]
) =>
  user.role === 'Admin' ||
  group.createdById === user.id ||
  members.some((m) => m.userId === user.id && m.role === 'admin');

export const createGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, memberIds } = req.body;
    const user = req.user! as AuthUser;

    const uniqueMemberIds = [...new Set<number>((memberIds ?? []).map(Number))].filter((id) => id !== user.id);
    if (uniqueMemberIds.length) {
      const count = await prisma.user.count({
        where: { id: { in: uniqueMemberIds }, organizationId: user.organizationId, isActive: true },
      });
      if (count !== uniqueMemberIds.length)
        return next(new AppError('One or more members are not in your organization', 400));
    }

    const group = await prisma.$transaction(async (tx) => {
      const sequenceId = await nextSequenceId(tx, user.organizationId, 'group');
      return tx.group.create({
        data: {
          name: name.trim(),
          organizationId: user.organizationId,
          createdById: user.id,
          sequenceId,
          members: {
            create: [
              { userId: user.id, role: 'admin', addedById: user.id },
              ...uniqueMemberIds.map((userId) => ({ userId, role: 'member' as const, addedById: user.id })),
            ],
          },
        },
        include: GROUP_INCLUDE,
      });
    });

    if (uniqueMemberIds.length) {
      void notifyUsers(uniqueMemberIds, user.id, {
        type: 'groupMemberAdded',
        title: `Added to ${group.name}`,
        message: `${req.user!.username ?? 'Someone'} added you to a group.`,
        groupId: group.id,
      });
    }

    res.status(201).json({ message: 'Group created', group });
  } catch (err) {
    next(err);
  }
};

// Groups the current user belongs to — no org-Admin "see everything" here,
// since this list backs the chat sidebar (a user's own groups), not an
// admin/audit view. Includes a lightweight lastMessage + unreadCount per
// group, mirroring chatController.getContacts' conversation-list shape.
export const getGroups = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user! as AuthUser;

    const groups = await prisma.group.findMany({
      where: { members: { some: { userId: user.id } } },
      include: GROUP_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });

    const groupsWithActivity = await Promise.all(
      groups.map(async (group) => {
        const [lastMessage, unreadCount] = await Promise.all([
          prisma.groupMessage.findFirst({
            where: { groupId: group.id, deletedFor: { none: { id: user.id } } },
            orderBy: { createdAt: 'desc' },
            include: { sender: { select: USER_SELECT } },
          }),
          prisma.groupMessage.count({
            where: {
              groupId: group.id,
              senderId: { not: user.id },
              deletedFor: { none: { id: user.id } },
              reads: { none: { userId: user.id } },
            },
          }),
        ]);
        return { ...group, lastMessage, unreadCount };
      })
    );

    res.status(200).json(groupsWithActivity);
  } catch (err) {
    next(err);
  }
};

export const getGroupById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.group.findUnique({
      where: { id: Number(req.params.groupId) },
      include: GROUP_INCLUDE,
    });
    if (!group) return next(new AppError('Group not found', 404));
    if (!canAccessGroup(req.user! as AuthUser, group)) return next(new AppError('You do not have access to this group', 403));

    res.status(200).json(group);
  } catch (err) {
    next(err);
  }
};

export const updateGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.group.findUnique({ where: { id: Number(req.params.groupId) }, include: GROUP_INCLUDE });
    if (!group) return next(new AppError('Group not found', 404));
    if (!canAccessGroup(req.user! as AuthUser, group)) return next(new AppError('You do not have access to this group', 403));
    if (!canManageGroup(req.user! as AuthUser, group, group.members))
      return next(new AppError('Only a group admin can update this group', 403));

    const { name, avatarUrl } = req.body;
    const updated = await prisma.group.update({
      where: { id: group.id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl: avatarUrl || null } : {}),
        updatedById: req.user!.id,
      },
      include: GROUP_INCLUDE,
    });

    res.status(200).json({ message: 'Group updated', group: updated });
  } catch (err) {
    next(err);
  }
};

// Mirrors authController.ts's updateAvatar — destroys the previous
// Cloudinary asset (if any) before saving the new one, so switching avatars
// repeatedly doesn't leak orphaned uploads.
export const uploadGroupAvatar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.group.findUnique({ where: { id: Number(req.params.groupId) }, include: GROUP_INCLUDE });
    if (!group) return next(new AppError('Group not found', 404));
    if (!canAccessGroup(req.user! as AuthUser, group)) return next(new AppError('You do not have access to this group', 403));
    if (!canManageGroup(req.user! as AuthUser, group, group.members))
      return next(new AppError('Only a group admin can update this group', 403));
    if (!req.file) return next(new AppError('No file uploaded', 400));

    if (group.avatarUrl) {
      const publicId = getPublicId(group.avatarUrl);
      if (publicId) await cloudinary.uploader.destroy(publicId).catch(() => {});
    }

    const updated = await prisma.group.update({
      where: { id: group.id },
      data: { avatarUrl: req.file.path, updatedById: req.user!.id },
      include: GROUP_INCLUDE,
    });

    res.status(200).json({ message: 'Group avatar updated', group: updated });
  } catch (err) {
    next(err);
  }
};

export const deleteGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.group.findUnique({ where: { id: Number(req.params.groupId) }, include: GROUP_INCLUDE });
    if (!group) return next(new AppError('Group not found', 404));
    if (!canAccessGroup(req.user! as AuthUser, group)) return next(new AppError('You do not have access to this group', 403));
    if (!canManageGroup(req.user! as AuthUser, group, group.members))
      return next(new AppError('Only a group admin can delete this group', 403));

    await prisma.group.delete({ where: { id: group.id } });
    res.status(200).json({ message: 'Group deleted' });
  } catch (err) {
    next(err);
  }
};

export const getGroupMembers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.group.findUnique({
      where: { id: Number(req.params.groupId) },
      include: { members: { include: MEMBER_INCLUDE, orderBy: { joinedAt: 'asc' } } },
    });
    if (!group) return next(new AppError('Group not found', 404));
    if (!canAccessGroup(req.user! as AuthUser, group)) return next(new AppError('You do not have access to this group', 403));

    res.status(200).json(group.members);
  } catch (err) {
    next(err);
  }
};

// Org-scoped, searchable user list for the "add members" picker — excludes
// existing members, mirrors projectMemberController.getMemberCandidates.
export const getGroupMemberCandidates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user! as AuthUser;
    const groupId = req.params.groupId ? Number(req.params.groupId) : null;

    let existingIds: number[] = [];
    if (groupId) {
      const group = await prisma.group.findUnique({ where: { id: groupId }, include: { members: { select: { userId: true } } } });
      if (!group) return next(new AppError('Group not found', 404));
      if (!canAccessGroup(user, group)) return next(new AppError('You do not have access to this group', 403));
      existingIds = group.members.map((m) => m.userId);
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = {
      isActive: true,
      organizationId: user.organizationId,
      id: { notIn: [...existingIds, user.id] },
    };
    const search = ((req.query.search as string) ?? '').trim();
    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, omit: { password: true }, orderBy: { username: 'asc' }, skip, take: limit }),
      prisma.user.count({ where }),
    ]);

    res.status(200).json({ users, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
};

export const addGroupMembers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.group.findUnique({ where: { id: Number(req.params.groupId) }, include: GROUP_INCLUDE });
    if (!group) return next(new AppError('Group not found', 404));
    if (!canAccessGroup(req.user! as AuthUser, group)) return next(new AppError('You do not have access to this group', 403));
    if (!canManageGroup(req.user! as AuthUser, group, group.members))
      return next(new AppError('Only a group admin can add members', 403));

    const existingIds = new Set(group.members.map((m) => m.userId));
    const newIds: number[] = [...new Set<number>(req.body.userIds.map(Number))].filter(
      (id) => !existingIds.has(id) && id !== req.user!.id
    );

    if (newIds.length) {
      const count = await prisma.user.count({
        where: { id: { in: newIds }, organizationId: req.user!.organizationId, isActive: true },
      });
      if (count !== newIds.length) return next(new AppError('One or more members are not in your organization', 400));

      await prisma.groupMember.createMany({
        data: newIds.map((userId) => ({ groupId: group.id, userId, role: 'member', addedById: req.user!.id })),
      });

      void notifyUsers(newIds, req.user!.id, {
        type: 'groupMemberAdded',
        title: `Added to ${group.name}`,
        message: `${req.user!.username ?? 'Someone'} added you to a group.`,
        groupId: group.id,
      });
    }

    const members = await prisma.groupMember.findMany({
      where: { groupId: group.id },
      include: MEMBER_INCLUDE,
      orderBy: { joinedAt: 'asc' },
    });
    res.status(200).json({ message: 'Members added', members });
  } catch (err) {
    next(err);
  }
};

export const updateGroupMemberRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.group.findUnique({ where: { id: Number(req.params.groupId) }, include: GROUP_INCLUDE });
    if (!group) return next(new AppError('Group not found', 404));
    if (!canAccessGroup(req.user! as AuthUser, group)) return next(new AppError('You do not have access to this group', 403));
    if (!canManageGroup(req.user! as AuthUser, group, group.members))
      return next(new AppError('Only a group admin can change member roles', 403));

    const target = group.members.find((m) => m.id === Number(req.params.memberId));
    if (!target) return next(new AppError('Member not found', 404));

    const { role } = req.body;
    if (target.role === 'admin' && role === 'member') {
      const remainingAdmins = group.members.filter((m) => m.role === 'admin' && m.id !== target.id);
      if (remainingAdmins.length === 0) return next(new AppError('A group must have at least one admin', 409));
    }

    await prisma.groupMember.update({ where: { id: target.id }, data: { role } });
    const members = await prisma.groupMember.findMany({
      where: { groupId: group.id },
      include: MEMBER_INCLUDE,
      orderBy: { joinedAt: 'asc' },
    });
    res.status(200).json({ message: 'Member role updated', members });
  } catch (err) {
    next(err);
  }
};

export const removeGroupMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.group.findUnique({ where: { id: Number(req.params.groupId) }, include: GROUP_INCLUDE });
    if (!group) return next(new AppError('Group not found', 404));
    if (!canAccessGroup(req.user! as AuthUser, group)) return next(new AppError('You do not have access to this group', 403));
    if (!canManageGroup(req.user! as AuthUser, group, group.members))
      return next(new AppError('Only a group admin can remove members', 403));

    const target = group.members.find((m) => m.id === Number(req.params.memberId));
    if (!target) return next(new AppError('Member not found', 404));
    if (target.role === 'admin' && group.members.filter((m) => m.role === 'admin').length === 1)
      return next(new AppError('A group must have at least one admin — reassign the admin role first', 409));

    await prisma.groupMember.delete({ where: { id: target.id } });
    const members = await prisma.groupMember.findMany({
      where: { groupId: group.id },
      include: MEMBER_INCLUDE,
      orderBy: { joinedAt: 'asc' },
    });
    res.status(200).json({ message: 'Member removed', members });
  } catch (err) {
    next(err);
  }
};

// Self-leave — distinct from removeGroupMember (admin-only). If the last
// admin leaves and other members remain, promotes the longest-tenured
// remaining member so the group never ends up admin-less. If the last
// member leaves, the group (and its messages, via onDelete: Cascade) goes
// with them — an empty group serves no purpose.
export const leaveGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.group.findUnique({ where: { id: Number(req.params.groupId) }, include: GROUP_INCLUDE });
    if (!group) return next(new AppError('Group not found', 404));

    const user = req.user! as AuthUser;
    const membership = group.members.find((m) => m.userId === user.id);
    if (!membership) return next(new AppError('You are not a member of this group', 404));

    const remaining = group.members.filter((m) => m.id !== membership.id);
    if (remaining.length === 0) {
      await prisma.group.delete({ where: { id: group.id } });
      return res.status(200).json({ message: 'Left group (group deleted, no members remained)' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.groupMember.delete({ where: { id: membership.id } });
      const remainingAdmins = remaining.filter((m) => m.role === 'admin');
      if (membership.role === 'admin' && remainingAdmins.length === 0) {
        const promoted = [...remaining].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
        await tx.groupMember.update({ where: { id: promoted.id }, data: { role: 'admin' } });
      }
    });

    res.status(200).json({ message: 'Left group' });
  } catch (err) {
    next(err);
  }
};
