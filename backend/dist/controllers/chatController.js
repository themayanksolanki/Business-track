import prisma from '../lib/prisma.js';
export const getIceServers = (_req, res) => {
    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ];
    const { TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL } = process.env;
    if (TURN_URLS && TURN_USERNAME && TURN_CREDENTIAL) {
        iceServers.push({
            urls: TURN_URLS.split(',').map((u) => u.trim()),
            username: TURN_USERNAME,
            credential: TURN_CREDENTIAL,
        });
    }
    res.json({ iceServers });
};
export const getContacts = async (req, res, next) => {
    try {
        const myId = req.user.id;
        const [me, blockedByThemRows, users, messages] = await Promise.all([
            prisma.user.findUnique({
                where: { id: myId },
                select: {
                    blockedUsers: { select: { id: true } },
                    mutedUsers: { select: { id: true } },
                },
            }),
            prisma.user.findMany({ where: { blockedUsers: { some: { id: myId } } }, select: { id: true } }),
            prisma.user.findMany({
                where: { id: { not: myId }, isActive: true },
                select: { id: true, username: true, profileImage: true, role: true },
            }),
            // Ordered newest-first so the first message we see per contact while
            // grouping below is necessarily their most recent one.
            prisma.message.findMany({
                where: {
                    OR: [{ senderId: myId }, { receiverId: myId }],
                    deletedFor: { none: { id: myId } },
                },
                orderBy: { createdAt: 'desc' },
                include: {
                    sender: { select: { id: true, username: true, profileImage: true } },
                    receiver: { select: { id: true, username: true, profileImage: true } },
                },
            }),
        ]);
        const blockedByThemSet = new Set(blockedByThemRows.map((u) => u.id));
        const myBlockedSet = new Set((me?.blockedUsers ?? []).map((u) => u.id));
        const myMutedSet = new Set((me?.mutedUsers ?? []).map((u) => u.id));
        const statsByUser = new Map();
        for (const msg of messages) {
            const otherId = msg.senderId === myId ? msg.receiverId : msg.senderId;
            let stats = statsByUser.get(otherId);
            if (!stats) {
                stats = { lastMessage: msg, unreadCount: 0 };
                statsByUser.set(otherId, stats);
            }
            if (msg.receiverId === myId && !msg.read)
                stats.unreadCount += 1;
        }
        const contacts = users.map((user) => {
            const stats = statsByUser.get(user.id);
            return {
                user,
                lastMessage: stats?.lastMessage ?? null,
                unreadCount: stats?.unreadCount ?? 0,
                isBlocked: myBlockedSet.has(user.id),
                blockedByThem: blockedByThemSet.has(user.id),
                isMuted: myMutedSet.has(user.id),
            };
        });
        // Sort: contacts with messages first (by last message time), then others
        contacts.sort((a, b) => {
            if (!a.lastMessage && !b.lastMessage)
                return 0;
            if (!a.lastMessage)
                return 1;
            if (!b.lastMessage)
                return -1;
            return new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime();
        });
        res.status(200).json(contacts);
    }
    catch (err) {
        next(err);
    }
};
export const getMessages = async (req, res, next) => {
    try {
        const myId = req.user.id;
        const userId = Number(req.params.userId);
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { senderId: myId, receiverId: userId },
                    { senderId: userId, receiverId: myId },
                ],
                deletedFor: { none: { id: myId } },
            },
            orderBy: { createdAt: 'asc' },
            include: {
                sender: { select: { id: true, username: true, profileImage: true } },
                receiver: { select: { id: true, username: true, profileImage: true } },
                replyTo: {
                    select: {
                        id: true,
                        content: true,
                        type: true,
                        sender: { select: { id: true, username: true } },
                    },
                },
            },
        });
        await prisma.message.updateMany({
            where: { senderId: userId, receiverId: myId, read: false },
            data: { read: true, delivered: true },
        });
        res.status(200).json(messages);
    }
    catch (err) {
        next(err);
    }
};
export const clearChat = async (req, res, next) => {
    try {
        const myId = req.user.id;
        const userId = Number(req.params.userId);
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { senderId: myId, receiverId: userId },
                    { senderId: userId, receiverId: myId },
                ],
            },
            select: { id: true },
        });
        // updateMany can't touch relation fields, so each message needs its own
        // update — `connect` is idempotent, matching the old $addToSet semantics.
        if (messages.length) {
            await prisma.$transaction(messages.map((m) => prisma.message.update({ where: { id: m.id }, data: { deletedFor: { connect: { id: myId } } } })));
        }
        res.status(200).json({ success: true });
    }
    catch (err) {
        next(err);
    }
};
export const toggleBlock = async (req, res, next) => {
    try {
        const myId = req.user.id;
        const userId = Number(req.params.userId);
        const me = await prisma.user.findUnique({
            where: { id: myId },
            select: { blockedUsers: { where: { id: userId }, select: { id: true } } },
        });
        const isBlocked = me.blockedUsers.length > 0;
        await prisma.user.update({
            where: { id: myId },
            data: { blockedUsers: isBlocked ? { disconnect: { id: userId } } : { connect: { id: userId } } },
        });
        res.status(200).json({ blocked: !isBlocked });
    }
    catch (err) {
        next(err);
    }
};
export const toggleMute = async (req, res, next) => {
    try {
        const myId = req.user.id;
        const userId = Number(req.params.userId);
        const me = await prisma.user.findUnique({
            where: { id: myId },
            select: { mutedUsers: { where: { id: userId }, select: { id: true } } },
        });
        const isMuted = me.mutedUsers.length > 0;
        await prisma.user.update({
            where: { id: myId },
            data: { mutedUsers: isMuted ? { disconnect: { id: userId } } : { connect: { id: userId } } },
        });
        res.status(200).json({ muted: !isMuted });
    }
    catch (err) {
        next(err);
    }
};
export const getCallHistory = async (req, res, next) => {
    try {
        const myId = req.user.id;
        const calls = await prisma.message.findMany({
            where: { type: 'call', OR: [{ senderId: myId }, { receiverId: myId }] },
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: {
                sender: { select: { id: true, username: true, profileImage: true, role: true } },
                receiver: { select: { id: true, username: true, profileImage: true, role: true } },
            },
        });
        res.status(200).json(calls);
    }
    catch (err) {
        next(err);
    }
};
export const uploadChatImage = async (req, res, next) => {
    try {
        if (!req.file)
            return res.status(400).json({ message: 'No file uploaded' });
        const url = req.file.path; // Cloudinary secure URL
        res.status(200).json({ url });
    }
    catch (err) {
        next(err);
    }
};
//# sourceMappingURL=chatController.js.map