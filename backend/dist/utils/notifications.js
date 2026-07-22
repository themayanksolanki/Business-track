import prisma from '../lib/prisma.js';
import { emitToUser } from '../socket.js';
const NOTIFICATION_INCLUDE = { actor: { select: { id: true, username: true, profileImage: true } } };
// Persists first, then pushes live — the DB row is the source of truth (it's
// what a client re-syncs from on login/refresh/reconnect), the socket emit is
// just the "don't make them wait for a refresh" nudge on top of that.
export const notifyUser = async (userId, actorId, payload) => {
    if (!userId || userId === actorId)
        return null;
    const notification = await prisma.notification.create({
        data: { userId, actorId: actorId ?? null, ...payload },
        include: NOTIFICATION_INCLUDE,
    });
    emitToUser(userId, 'notification:new', notification);
    return notification;
};
export const notifyUsers = (userIds, actorId, payload) => Promise.all([...new Set(userIds)].map((id) => notifyUser(id, actorId, payload)));
//# sourceMappingURL=notifications.js.map