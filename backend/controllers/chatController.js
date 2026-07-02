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
    const users = await User.find({ _id: { $ne: myId }, isActive: true })
      .select('username profileImage role');

    const contacts = await Promise.all(
      users.map(async (user) => {
        const lastMessage = await Message.findOne({
          $or: [
            { sender: myId, receiver: user._id },
            { sender: user._id, receiver: myId },
          ],
        }).sort({ createdAt: -1 });

        const unreadCount = await Message.countDocuments({
          sender: user._id,
          receiver: myId,
          read: false,
        });

        return { user, lastMessage, unreadCount };
      })
    );

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
    })
      .sort({ createdAt: 1 })
      .populate('sender', 'username profileImage')
      .populate('receiver', 'username profileImage');

    await Message.updateMany(
      { sender: userId, receiver: myId, read: false },
      { read: true, delivered: true }
    );

    res.status(200).json(messages);
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
