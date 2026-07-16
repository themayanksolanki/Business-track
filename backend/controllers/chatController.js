import Message from '../models/Message.js';
import User from '../models/User.js';

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
    const myId = req.user._id;
    const me = await User.findById(myId).select('blockedUsers mutedContacts');
    const blockedByThemIds = await User.find({ blockedUsers: myId }).distinct('_id');
    const blockedByThemSet = new Set(blockedByThemIds.map(String));
    const myBlockedSet = new Set((me?.blockedUsers ?? []).map(String));
    const myMutedSet = new Set((me?.mutedContacts ?? []).map(String));

    const users = await User.find({ _id: { $ne: myId }, isActive: true })
      .select('username profileImage role');

    const contactStats = await Message.aggregate([
      {
        $match: {
          $or: [{ sender: myId }, { receiver: myId }],
          deletedFor: { $ne: myId },
        },
      },
      {
        $addFields: {
          otherUser: { $cond: [{ $eq: ['$sender', myId] }, '$receiver', '$sender'] },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$otherUser',
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$receiver', myId] }, { $eq: ['$read', false] }] }, 1, 0],
            },
          },
        },
      },
    ]);
    const statsByUser = new Map(contactStats.map((s) => [String(s._id), s]));

    const contacts = users.map((user) => {
      const uidStr = user._id.toString();
      const stats = statsByUser.get(uidStr);

      return {
        user,
        lastMessage: stats?.lastMessage ?? null,
        unreadCount: stats?.unreadCount ?? 0,
        isBlocked: myBlockedSet.has(uidStr),
        blockedByThem: blockedByThemSet.has(uidStr),
        isMuted: myMutedSet.has(uidStr),
      };
    });

    // Sort: contacts with messages first (by last message time), then others
    contacts.sort((a, b) => {
      if (!a.lastMessage && !b.lastMessage) return 0;
      if (!a.lastMessage) return 1;
      if (!b.lastMessage) return -1;
      return new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt);
    });

    res.status(200).json(contacts);
  } catch (err) {
    next(err);
  }
};

export const getMessages = async (req, res, next) => {
  try {
    const myId = req.user._id;
    const { userId } = req.params;

    const messages = await Message.find({
      $or: [
        { sender: myId, receiver: userId },
        { sender: userId, receiver: myId },
      ],
      deletedFor: { $ne: myId },
    })
      .sort({ createdAt: 1 })
      .populate('sender', 'username profileImage')
      .populate('receiver', 'username profileImage')
      .populate({
        path: 'replyTo',
        select: 'content type sender',
        populate: { path: 'sender', select: 'username' },
      });

    await Message.updateMany(
      { sender: userId, receiver: myId, read: false },
      { read: true, delivered: true }
    );

    res.status(200).json(messages);
  } catch (err) {
    next(err);
  }
};

export const clearChat = async (req, res, next) => {
  try {
    const myId = req.user._id;
    const { userId } = req.params;

    await Message.updateMany(
      {
        $or: [
          { sender: myId, receiver: userId },
          { sender: userId, receiver: myId },
        ],
      },
      { $addToSet: { deletedFor: myId } }
    );

    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const toggleBlock = async (req, res, next) => {
  try {
    const myId = req.user._id;
    const { userId } = req.params;

    const me = await User.findById(myId);
    const idx = me.blockedUsers.findIndex((id) => id.toString() === userId);
    let blocked;
    if (idx >= 0) {
      me.blockedUsers.splice(idx, 1);
      blocked = false;
    } else {
      me.blockedUsers.push(userId);
      blocked = true;
    }
    await me.save();

    res.status(200).json({ blocked });
  } catch (err) {
    next(err);
  }
};

export const toggleMute = async (req, res, next) => {
  try {
    const myId = req.user._id;
    const { userId } = req.params;

    const me = await User.findById(myId);
    const idx = me.mutedContacts.findIndex((id) => id.toString() === userId);
    let muted;
    if (idx >= 0) {
      me.mutedContacts.splice(idx, 1);
      muted = false;
    } else {
      me.mutedContacts.push(userId);
      muted = true;
    }
    await me.save();

    res.status(200).json({ muted });
  } catch (err) {
    next(err);
  }
};

export const getCallHistory = async (req, res, next) => {
  try {
    const myId = req.user._id;
    const calls = await Message.find({
      type: 'call',
      $or: [{ sender: myId }, { receiver: myId }],
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('sender',   'username profileImage role')
      .populate('receiver', 'username profileImage role');
    res.status(200).json(calls);
  } catch (err) {
    next(err);
  }
};

export const uploadChatImage = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const url = req.file.path; // Cloudinary secure URL
    res.status(200).json({ url });
  } catch (err) {
    next(err);
  }
};
