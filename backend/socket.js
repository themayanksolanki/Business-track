import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import Message from './models/Message.js';

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
    const sockets = onlineUsers.get(userId);
    if (sockets) sockets.forEach((sid) => io.to(sid).emit(event, data));
  };

  // Save a call record and push it to both parties via socket
  const saveCallRecord = async (session, callId, status) => {
    const startMs = callStartTimes.get(callId);
    const duration = startMs ? Math.round((Date.now() - startMs) / 1000) : null;
    callStartTimes.delete(callId);
    try {
      const msg = await Message.create({
        sender:       session.caller,
        receiver:     session.callee,
        type:         'call',
        callType:     session.callType,
        callStatus:   status,
        callDuration: duration,
        content:      '',
        delivered:    true,
        read:         true,
      });
      const populated = await msg.populate([
        { path: 'sender',   select: 'username profileImage role' },
        { path: 'receiver', select: 'username profileImage role' },
      ]);
      emitToUser(session.caller, 'call:logged', populated);
      emitToUser(session.callee, 'call:logged', populated);
    } catch { /* non-critical */ }
  };

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    io.emit('users:online', Array.from(onlineUsers.keys()));

    // Deliver any messages sent while this user was offline
    try {
      const senderIds = await Message.find({ receiver: userId, delivered: false }).distinct('sender');
      if (senderIds.length) {
        await Message.updateMany({ receiver: userId, delivered: false }, { delivered: true });
        senderIds.forEach((sid) => emitToUser(sid.toString(), 'message:delivered', { by: userId }));
      }
    } catch { /* non-critical */ }

    // ── Chat messages ──────────────────────────────────────────────
    socket.on('message:send', async ({ to, content, type, fileUrl }) => {
      try {
        const msg = await Message.create({
          sender: userId,
          receiver: to,
          content: content || '',
          type: type || 'text',
          fileUrl: fileUrl || null,
        });
        const populated = await msg.populate([
          { path: 'sender', select: 'username profileImage' },
          { path: 'receiver', select: 'username profileImage' },
        ]);

        socket.emit('message:sent', populated);

        emitToUser(to, 'message:receive', populated);

        if (onlineUsers.has(to)) {
          await Message.findByIdAndUpdate(msg._id, { delivered: true });
          emitToUser(userId, 'message:delivered', { by: to });
        }
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
      if (!onlineUsers.has(to)) { socket.emit('call:user-offline'); return; }
      const callId = randomUUID();
      activeCalls.set(callId, { caller: userId, callee: to, callType, state: 'ringing' });
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
        await Message.updateMany(
          { sender: from, receiver: userId, read: false },
          { read: true, delivered: true }
        );
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
