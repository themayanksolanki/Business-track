import type { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { canAccessGroup } from './groupController.js';

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };

export const GROUP_MESSAGE_INCLUDE = {
  sender: { select: USER_SELECT },
  replyTo: { select: { id: true, content: true, type: true, sender: { select: { id: true, username: true } } } },
  reads: { select: { userId: true } },
  // Only populated for type: 'call' — lets the frontend render the call
  // card (in progress / ended) and, per viewer, whether THEY joined or
  // missed it (meeting.participants[].joinedAt), without a second request.
  meeting: {
    select: {
      id: true,
      roomCode: true,
      status: true,
      callType: true,
      startedAt: true,
      endedAt: true,
      hostId: true,
      participants: { select: { userId: true, joinedAt: true } },
    },
  },
};

type AuthUser = { id: number; role: string; organizationId: number | null };

// Full history in one shot, no pagination — mirrors chatController.getMessages
// (1:1 chat has no pagination either). Opening the thread also bulk-marks
// every unread message as read by this member, same "viewing marks it read"
// convention as the 1:1 REST fetch.
export const getGroupMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await prisma.group.findUnique({
      where: { id: Number(req.params.groupId) },
      include: { members: { select: { userId: true } } },
    });
    if (!group) return next(new AppError('Group not found', 404));
    if (!canAccessGroup(req.user! as AuthUser, group)) return next(new AppError('You do not have access to this group', 403));

    const user = req.user! as AuthUser;
    const messages = await prisma.groupMessage.findMany({
      where: { groupId: group.id, deletedFor: { none: { id: user.id } } },
      orderBy: { createdAt: 'asc' },
      include: GROUP_MESSAGE_INCLUDE,
    });

    const unreadIds = messages.filter((m) => m.senderId !== user.id && !m.reads.some((r) => r.userId === user.id)).map((m) => m.id);
    if (unreadIds.length) {
      await prisma.groupMessageRead.createMany({
        data: unreadIds.map((groupMessageId) => ({ groupMessageId, userId: user.id })),
        skipDuplicates: true,
      });
    }

    res.status(200).json(messages);
  } catch (err) {
    next(err);
  }
};
