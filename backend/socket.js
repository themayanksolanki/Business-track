import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from './models/Message.js';

const onlineUsers = new Map(); // userId (string) → socketId

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

  io.on('connection', (socket) => {
    const userId = socket.userId;
    onlineUsers.set(userId, socket.id);
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

        const receiverSocket = onlineUsers.get(to);
        if (receiverSocket) io.to(receiverSocket).emit('message:receive', populated);
      } catch (err) {
        socket.emit('message:error', err.message);
      }
    });

    // ── Call signaling ─────────────────────────────────────────────
    socket.on('call:request', ({ to, callType, fromName }) => {
      const target = onlineUsers.get(to);
      if (target) {
        io.to(target).emit('call:incoming', { from: userId, fromName, callType });
      } else {
        socket.emit('call:user-offline');
      }
    });

    socket.on('call:accepted', ({ to }) => {
      const target = onlineUsers.get(to);
      if (target) io.to(target).emit('call:accepted');
    });

    socket.on('call:rejected', ({ to }) => {
      const target = onlineUsers.get(to);
      if (target) io.to(target).emit('call:rejected');
    });

    socket.on('call:ended', ({ to }) => {
      const target = onlineUsers.get(to);
      if (target) io.to(target).emit('call:ended');
    });

    socket.on('call:offer', ({ to, offer }) => {
      const target = onlineUsers.get(to);
      if (target) io.to(target).emit('call:offer', { from: userId, offer });
    });

    socket.on('call:answer', ({ to, answer }) => {
      const target = onlineUsers.get(to);
      if (target) io.to(target).emit('call:answer', { answer });
    });

    socket.on('call:ice-candidate', ({ to, candidate }) => {
      const target = onlineUsers.get(to);
      if (target) io.to(target).emit('call:ice-candidate', { candidate });
    });

    // ── Disconnect ────────────────────────────────────────────────
    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      io.emit('users:online', Array.from(onlineUsers.keys()));
    });
  });

  return io;
}
