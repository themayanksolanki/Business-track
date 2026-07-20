import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from './lib/prisma.js';

const SENDER_RECEIVER_SELECT = { id: true, username: true, profileImage: true };
const MESSAGE_INCLUDE = {
  sender: { select: SENDER_RECEIVER_SELECT },
  receiver: { select: SENDER_RECEIVER_SELECT },
  replyTo: {
    select: {
      id: true,
      content: true,
      type: true,
      sender: { select: { id: true, username: true } },
    },
  },
};

const DELETE_FOR_ALL_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

const onlineUsers  = new Map(); // userId  → Set<socketId>
const activeCalls  = new Map(); // callId  → { caller, callee, callType, state }
const callStartTimes = new Map(); // callId → Date.now() when state became 'active'

export function setupSocket(server) {
  const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:4200')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const io = new Server(server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) {
          return cb(null, true);
        }

        return cb(new Error('CORS: origin not allowed'));
      },
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id.toString();
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  const emitToUser = (userId, event, data) => {
    const sockets = onlineUsers.get(String(userId));
    if (sockets) sockets.forEach((sid) => io.to(sid).emit(event, data));
  };

  // Save a call record and push it to both parties via socket
  const saveCallRecord = async (session, callId, status) => {
    const startMs = callStartTimes.get(callId);
    const duration = startMs ? Math.round((Date.now() - startMs) / 1000) : null;
    callStartTimes.delete(callId);
    try {
      const msg = await prisma.message.create({
        data: {
          senderId: Number(session.caller),
          receiverId: Number(session.callee),
          type: 'call',
          callType: session.callType,
          callStatus: status,
          callDuration: duration,
          content: '',
          delivered: true,
          read: true,
        },
        include: { sender: { select: { id: true, username: true, profileImage: true, role: true } }, receiver: { select: { id: true, username: true, profileImage: true, role: true } } },
      });
      emitToUser(session.caller, 'call:logged', msg);
      emitToUser(session.callee, 'call:logged', msg);
    } catch { /* non-critical */ }
  };

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    const myId = Number(userId);
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    io.emit('users:online', Array.from(onlineUsers.keys()));

    // Deliver any messages sent while this user was offline
    try {
      const undelivered = await prisma.message.findMany({
        where: { receiverId: myId, delivered: false },
        select: { senderId: true },
        distinct: ['senderId'],
      });
      if (undelivered.length) {
        await prisma.message.updateMany({ where: { receiverId: myId, delivered: false }, data: { delivered: true } });
        undelivered.forEach(({ senderId }) => emitToUser(senderId, 'message:delivered', { by: userId }));
      }
    } catch { /* non-critical */ }

    // ── Chat messages ──────────────────────────────────────────────
    socket.on('message:send', async ({ to, content, type, fileUrl, replyTo }) => {
      try {
        const toId = Number(to);
        const [me, recipient] = await Promise.all([
          prisma.user.findUnique({ where: { id: myId }, select: { blockedUsers: { select: { id: true } } } }),
          prisma.user.findUnique({ where: { id: toId }, select: { blockedUsers: { select: { id: true } } } }),
        ]);
        const blocked =
          me?.blockedUsers?.some((u) => u.id === toId) ||
          recipient?.blockedUsers?.some((u) => u.id === myId);
        if (blocked) {
          socket.emit('message:error', 'You cannot message this user.');
          return;
        }

        const msg = await prisma.message.create({
          data: {
            senderId: myId,
            receiverId: toId,
            content: content || '',
            type: type || 'text',
            fileUrl: fileUrl || null,
            replyToId: replyTo ? Number(replyTo) : null,
          },
          include: MESSAGE_INCLUDE,
        });

        socket.emit('message:sent', msg);

        emitToUser(to, 'message:receive', msg);

        if (onlineUsers.has(String(to))) {
          await prisma.message.update({ where: { id: msg.id }, data: { delivered: true } });
          emitToUser(userId, 'message:delivered', { by: to });
        }
      } catch (err) {
        socket.emit('message:error', err.message);
      }
    });

    socket.on('message:edit', async ({ messageId, content }) => {
      try {
        const msg = await prisma.message.findUnique({ where: { id: Number(messageId) } });
        if (!msg || msg.senderId !== myId || msg.type !== 'text' || msg.isDeleted) return;

        const updated = await prisma.message.update({
          where: { id: msg.id },
          data: { content: content || '', isEdited: true, editedAt: new Date() },
          include: MESSAGE_INCLUDE,
        });
        emitToUser(updated.senderId, 'message:edited', updated);
        emitToUser(updated.receiverId, 'message:edited', updated);
      } catch (err) {
        socket.emit('message:error', err.message);
      }
    });

    socket.on('message:delete', async ({ messageId, forAll }) => {
      try {
        const msg = await prisma.message.findUnique({ where: { id: Number(messageId) } });
        if (!msg) return;
        const isSender = msg.senderId === myId;
        const isReceiver = msg.receiverId === myId;
        if (!isSender && !isReceiver) return;

        if (forAll) {
          if (!isSender) return;
          if (Date.now() - msg.createdAt.getTime() > DELETE_FOR_ALL_WINDOW_MS) {
            socket.emit('message:error', 'Delete for everyone is only available within 2 hours of sending.');
            return;
          }
          await prisma.message.update({
            where: { id: msg.id },
            data: { isDeleted: true, content: '', fileUrl: null },
          });
          emitToUser(msg.senderId, 'message:deleted', { messageId, forAll: true });
          emitToUser(msg.receiverId, 'message:deleted', { messageId, forAll: true });
        } else {
          // connect is idempotent, so no need to pre-check membership like
          // the old $addToSet-guarded push did.
          await prisma.message.update({
            where: { id: msg.id },
            data: { deletedFor: { connect: { id: myId } } },
          });
          socket.emit('message:deleted', { messageId, forAll: false });
        }
      } catch (err) {
        socket.emit('message:error', err.message);
      }
    });

    socket.on('message:pin', async ({ messageId, pinned }) => {
      try {
        const msg = await prisma.message.findUnique({ where: { id: Number(messageId) } });
        if (!msg) return;
        if (![msg.senderId, msg.receiverId].includes(myId)) return;
        const updated = await prisma.message.update({
          where: { id: msg.id },
          data: { isPinned: !!pinned },
        });
        emitToUser(updated.senderId, 'message:pinned', { messageId, pinned: updated.isPinned });
        emitToUser(updated.receiverId, 'message:pinned', { messageId, pinned: updated.isPinned });
      } catch (err) {
        socket.emit('message:error', err.message);
      }
    });

    // ── Call signaling ─────────────────────────────────────────────
    const otherParty = (callId) => {
      const s = activeCalls.get(callId);
      if (!s) return null;
      return s.caller === userId ? s.callee : s.caller;
    };

    socket.on('call:request', ({ to, callType, fromName }) => {
      if (!onlineUsers.has(String(to))) { socket.emit('call:user-offline'); return; }
      const callId = randomUUID();
      activeCalls.set(callId, { caller: userId, callee: String(to), callType, state: 'ringing' });
      socket.emit('call:session', { callId });
      emitToUser(to, 'call:incoming', { from: userId, fromName, callType, callId });
    });

    socket.on('call:accepted', ({ callId }) => {
      const session = activeCalls.get(callId);
      if (!session || session.callee !== userId) return;
      session.state = 'active';
      callStartTimes.set(callId, Date.now());
      emitToUser(session.caller, 'call:accepted', { callId });
    });

    socket.on('call:rejected', ({ callId }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      const other = otherParty(callId);
      activeCalls.delete(callId);
      void saveCallRecord(session, callId, 'rejected');
      if (other) emitToUser(other, 'call:rejected', { callId });
    });

    socket.on('call:ended', ({ callId }) => {
      const session = activeCalls.get(callId);
      if (!session) return;
      const other = otherParty(callId);
      const status = session.state === 'active' ? 'completed' : 'missed';
      activeCalls.delete(callId);
      void saveCallRecord(session, callId, status);
      if (other) emitToUser(other, 'call:ended', { callId });
    });

    socket.on('call:offer',          ({ callId, offer })      => { const o = otherParty(callId); if (o) emitToUser(o, 'call:offer',          { from: userId, offer, callId }); });
    socket.on('call:answer',         ({ callId, answer })     => { const o = otherParty(callId); if (o) emitToUser(o, 'call:answer',         { answer, callId }); });
    socket.on('call:ice-candidate',  ({ callId, candidate })  => { const o = otherParty(callId); if (o) emitToUser(o, 'call:ice-candidate',  { candidate, callId }); });
    socket.on('call:mute',           ({ callId, muted })      => { const o = otherParty(callId); if (o) emitToUser(o, 'call:mute',           { muted, callId }); });

    // ── Read receipts ─────────────────────────────────────────────
    socket.on('message:seen', async ({ from }) => {
      try {
        await prisma.message.updateMany({
          where: { senderId: Number(from), receiverId: myId, read: false },
          data: { read: true, delivered: true },
        });
        emitToUser(from, 'message:seen', { by: userId });
      } catch { /* non-critical */ }
    });

    // ── Disconnect ────────────────────────────────────────────────
    socket.on('disconnect', () => {
      for (const [callId, session] of activeCalls) {
        if (session.caller === userId || session.callee === userId) {
          const other = session.caller === userId ? session.callee : session.caller;
          const status = session.state === 'active' ? 'completed' : 'missed';
          activeCalls.delete(callId);
          void saveCallRecord(session, callId, status);
          emitToUser(other, 'call:ended', { callId });
        }
      }

      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) onlineUsers.delete(userId);
      }
      io.emit('users:online', Array.from(onlineUsers.keys()));
    });
  });

  return io;
}
