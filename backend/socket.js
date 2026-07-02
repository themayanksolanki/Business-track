import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from './models/Message.js';

const onlineUsers = new Map(); // userId (string) → Set<socketId>

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

  io.on('connection', (socket) => {
    const userId = socket.userId;
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    io.emit('users:online', Array.from(onlineUsers.keys()));

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
      } catch (err) {
        socket.emit('message:error', err.message);
      }
    });

    // ── Call signaling ─────────────────────────────────────────────
    socket.on('call:request', ({ to, callType, fromName }) => {
      if (onlineUsers.has(to)) {
        emitToUser(to, 'call:incoming', { from: userId, fromName, callType });
      } else {
        socket.emit('call:user-offline');
      }
    });

    socket.on('call:accepted', ({ to }) => emitToUser(to, 'call:accepted'));
    socket.on('call:rejected', ({ to }) => emitToUser(to, 'call:rejected'));
    socket.on('call:ended',    ({ to }) => emitToUser(to, 'call:ended'));

    socket.on('call:offer', ({ to, offer }) =>
      emitToUser(to, 'call:offer', { from: userId, offer })
    );

    socket.on('call:answer', ({ to, answer }) =>
      emitToUser(to, 'call:answer', { answer })
    );

    socket.on('call:ice-candidate', ({ to, candidate }) =>
      emitToUser(to, 'call:ice-candidate', { candidate })
    );

    socket.on('call:mute', ({ to, muted }) =>
      emitToUser(to, 'call:mute', { muted })
    );

    // ── Disconnect ────────────────────────────────────────────────
    socket.on('disconnect', () => {
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
