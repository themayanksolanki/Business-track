import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
const NOTIFICATION_INCLUDE = { actor: { select: { id: true, username: true, profileImage: true } } };
const RECENT_LIMIT = 30;
export const getNotifications = async (req, res, next) => {
    try {
        const [notifications, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where: { userId: req.user.id },
                include: NOTIFICATION_INCLUDE,
                orderBy: { createdAt: 'desc' },
                take: RECENT_LIMIT,
            }),
            prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
        ]);
        res.status(200).json({ notifications, unreadCount });
    }
    catch (err) {
        next(err);
    }
};
export const markAsRead = async (req, res, next) => {
    try {
        const notification = await prisma.notification.findFirst({
            where: { id: Number(req.params.id), userId: req.user.id },
        });
        if (!notification)
            return next(new AppError('Notification not found', 404));
        const updated = await prisma.notification.update({
            where: { id: notification.id },
            data: { isRead: true },
            include: NOTIFICATION_INCLUDE,
        });
        res.status(200).json({ message: 'Notification marked as read', notification: updated });
    }
    catch (err) {
        next(err);
    }
};
export const markAllAsRead = async (req, res, next) => {
    try {
        await prisma.notification.updateMany({
            where: { userId: req.user.id, isRead: false },
            data: { isRead: true },
        });
        res.status(200).json({ message: 'All notifications marked as read' });
    }
    catch (err) {
        next(err);
    }
};
//# sourceMappingURL=notificationController.js.map