import type { NotificationType } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { emitToUser } from '../socket.js';

const NOTIFICATION_INCLUDE = { actor: { select: { id: true, username: true, profileImage: true } } };

// Exactly one of projectId/taskId/projectItemId/commentId is meaningfully
// used per `type` (see notification.prisma) — callers pass whichever one(s)
// their notification type needs.
interface NotificationPayload {
  type: NotificationType;
  title: string;
  message: string;
  projectId?: number;
  taskId?: number;
  projectItemId?: number;
  commentId?: number;
}

// Persists first, then pushes live — the DB row is the source of truth (it's
// what a client re-syncs from on login/refresh/reconnect), the socket emit is
// just the "don't make them wait for a refresh" nudge on top of that.
export const notifyUser = async (userId: number, actorId: number | null | undefined, payload: NotificationPayload) => {
  if (!userId || userId === actorId) return null;

  const notification = await prisma.notification.create({
    data: { userId, actorId: actorId ?? null, ...payload },
    include: NOTIFICATION_INCLUDE,
  });
  emitToUser(userId, 'notification:new', notification);
  return notification;
};

export const notifyUsers = (userIds: number[], actorId: number | null | undefined, payload: NotificationPayload) =>
  Promise.all([...new Set(userIds)].map((id) => notifyUser(id, actorId, payload)));
