import { Server, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import type { CallType, CallStatus, MessageType } from '@prisma/client';
import prisma from './lib/prisma.js';
import { verifyRoomToken } from './utils/meetingToken.js';

// Native mesh WebRTC scales poorly past a handful of participants (each
// client uploads N-1 streams) — capped here until an SFU is worth building.
const MEETING_ROOM_CAPACITY = 4;
const meetingRoom = (meetingId: number) => `meeting:${meetingId}`;

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
  reactions: { select: { userId: true, emoji: true } },
};

const DELETE_FOR_ALL_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

// Incoming client -> server events this app actually listens for — payload
// shapes are whatever the frontend's socket service sends, still untrusted
// (ids get re-coerced with Number()/String() below just like before).
interface ClientToServerEvents {
  'message:send': (payload: {
    to: string | number;
    content?: string;
    type?: MessageType;
    fileUrl?: string;
    replyTo?: string | number;
  }) => void;
  'message:edit': (payload: { messageId: string | number; content?: string }) => void;
  'message:delete': (payload: { messageId: string | number; forAll?: boolean }) => void;
  'message:pin': (payload: { messageId: string | number; pinned?: boolean }) => void;
  'message:react': (payload: { messageId: string | number; emoji: string }) => void;
  'typing:start': (payload: { to: string | number }) => void;
  'typing:stop': (payload: { to: string | number }) => void;
  'call:request': (payload: { to: string | number; callType: CallType; fromName: string }) => void;
  'call:accepted': (payload: { callId: string }) => void;
  'call:rejected': (payload: { callId: string }) => void;
  'call:ended': (payload: { callId: string }) => void;
  'call:offer': (payload: { callId: string; offer: unknown }) => void;
  'call:answer': (payload: { callId: string; answer: unknown }) => void;
  'call:ice-candidate': (payload: { callId: string; candidate: unknown }) => void;
  'call:mute': (payload: { callId: string; muted: boolean }) => void;
  'message:seen': (payload: { from: string | number }) => void;
  'meeting:join': (payload: { roomToken: string }) => void;
  'meeting:leave': (payload: { meetingId: number }) => void;
  'meeting:signal': (payload: { meetingId: number; toSocketId: string; sdp?: unknown; candidate?: unknown }) => void;
  'meeting:mute': (payload: { meetingId: number; muted: boolean }) => void;
  'meeting:video-toggle': (payload: { meetingId: number; off: boolean }) => void;
}

// Outgoing server -> client events are emitted from many not-yet-migrated
// controller files via emitToUser with varying event names/payloads, so this
// stays a loose index rather than an exhaustive map for now.
interface ServerToClientEvents {
  [event: string]: (...args: any[]) => void;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents> & { userId: string };

interface CallSession {
  caller: string;
  callee: string;
  callType: CallType;
  state: 'ringing' | 'active';
}

const onlineUsers = new Map<string, Set<string>>(); // userId  → Set<socketId>
const activeCalls = new Map<string, CallSession>(); // callId  → session
const callStartTimes = new Map<string, number>(); // callId → Date.now() when state became 'active'

// socketId → which meeting room it's in, so disconnect can clean it up.
// Socket.IO's own room membership (io.sockets.adapter.rooms) is otherwise
// authoritative for "who's currently in the room".
const meetingSocketUsers = new Map<string, { meetingId: number; userId: number }>();

// Set once setupSocket() runs; other modules (notification triggers in
// controllers) import emitToUser rather than reaching into this directly.
let io: Server<ClientToServerEvents, ServerToClientEvents>;

// Fans an event out to every socket a user currently has open (multiple
// tabs/devices all get it) — a no-op if the user isn't connected, since the
// caller (e.g. a notification trigger) always persists first regardless.
export const emitToUser = (userId: string | number, event: string, data: unknown): void => {
  const sockets = onlineUsers.get(String(userId));
  if (sockets) sockets.forEach((sid) => io.to(sid).emit(event, data));
};

export function setupSocket(server: HttpServer) {
  const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:4200')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  io = new Server(server, {
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
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: number | string };
      (socket as AppSocket).userId = decoded.id.toString();
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  // Save a call record and push it to both parties via socket
  const saveCallRecord = async (session: CallSession, callId: string, status: CallStatus) => {
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
    const userId = (socket as AppSocket).userId;
    const myId = Number(userId);
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId)!.add(socket.id);
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

        emitToUser(userId, 'message:sent', msg);

        emitToUser(to, 'message:receive', msg);

        if (onlineUsers.has(String(to))) {
          await prisma.message.update({ where: { id: msg.id }, data: { delivered: true } });
          emitToUser(userId, 'message:delivered', { by: to });
        }
      } catch (err: any) {
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
      } catch (err: any) {
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
      } catch (err: any) {
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
      } catch (err: any) {
        socket.emit('message:error', err.message);
      }
    });

    // One reaction per user per message: same emoji again removes it, a
    // different emoji replaces it (mirrors the @@unique([messageId, userId])
    // constraint on MessageReaction).
    socket.on('message:react', async ({ messageId, emoji }) => {
      try {
        const msg = await prisma.message.findUnique({ where: { id: Number(messageId) } });
        if (!msg) return;
        if (![msg.senderId, msg.receiverId].includes(myId)) return;

        const existing = await prisma.messageReaction.findUnique({
          where: { messageId_userId: { messageId: msg.id, userId: myId } },
        });

        if (existing && existing.emoji === emoji) {
          await prisma.messageReaction.delete({ where: { id: existing.id } });
        } else if (existing) {
          await prisma.messageReaction.update({ where: { id: existing.id }, data: { emoji } });
        } else {
          await prisma.messageReaction.create({ data: { messageId: msg.id, userId: myId, emoji } });
        }

        const reactions = await prisma.messageReaction.findMany({
          where: { messageId: msg.id },
          select: { userId: true, emoji: true },
        });

        emitToUser(msg.senderId, 'message:reaction', { messageId: msg.id, reactions });
        emitToUser(msg.receiverId, 'message:reaction', { messageId: msg.id, reactions });
      } catch (err: any) {
        socket.emit('message:error', err.message);
      }
    });

    // ── Call signaling ─────────────────────────────────────────────
    const otherParty = (callId: string) => {
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

    // ── Meeting room signaling (N-way mesh) ─────────────────────────
    // First use of native Socket.IO rooms in this codebase — 1:1 calls above
    // route by userId via emitToUser instead. A meeting room needs broadcast
    // to an arbitrary number of members, which rooms give for free.
    const leaveMeetingRoom = (meetingId: number) => {
      const room = meetingRoom(meetingId);
      socket.leave(room);
      meetingSocketUsers.delete(socket.id);
      socket.to(room).emit('meeting:participant-left', { socketId: socket.id });
    };

    socket.on('meeting:join', ({ roomToken }) => {
      let payload;
      try {
        payload = verifyRoomToken(roomToken);
      } catch {
        socket.emit('meeting:join-error', { message: 'Invalid or expired room token' });
        return;
      }
      if (payload.userId !== myId) {
        socket.emit('meeting:join-error', { message: 'Room token does not match this session' });
        return;
      }

      const room = meetingRoom(payload.meetingId);
      const existingSocketIds = Array.from(io.sockets.adapter.rooms.get(room) ?? []);
      if (existingSocketIds.length >= MEETING_ROOM_CAPACITY) {
        socket.emit('meeting:room-full');
        return;
      }

      const members = existingSocketIds
        .map((sid) => {
          const m = meetingSocketUsers.get(sid);
          return m ? { socketId: sid, userId: m.userId } : null;
        })
        .filter((m): m is { socketId: string; userId: number } => !!m);

      socket.join(room);
      meetingSocketUsers.set(socket.id, { meetingId: payload.meetingId, userId: myId });

      socket.emit('meeting:joined', { members });
      socket.to(room).emit('meeting:participant-joined', { socketId: socket.id, userId: myId });
    });

    socket.on('meeting:leave', ({ meetingId }) => {
      if (!socket.rooms.has(meetingRoom(meetingId))) return;
      leaveMeetingRoom(meetingId);
    });

    socket.on('meeting:signal', ({ meetingId, toSocketId, sdp, candidate }) => {
      if (!socket.rooms.has(meetingRoom(meetingId))) return;
      io.to(toSocketId).emit('meeting:signal', { fromSocketId: socket.id, sdp, candidate });
    });

    socket.on('meeting:mute', ({ meetingId, muted }) => {
      const room = meetingRoom(meetingId);
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('meeting:mute', { socketId: socket.id, muted });
    });

    socket.on('meeting:video-toggle', ({ meetingId, off }) => {
      const room = meetingRoom(meetingId);
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('meeting:video-toggle', { socketId: socket.id, off });
    });

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

    // ── Typing indicator (ephemeral relay, no persistence) ─────────
    socket.on('typing:start', ({ to }) => emitToUser(to, 'typing:update', { from: userId, isTyping: true }));
    socket.on('typing:stop',  ({ to }) => emitToUser(to, 'typing:update', { from: userId, isTyping: false }));

    // ── Disconnect ────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const meetingMembership = meetingSocketUsers.get(socket.id);
      if (meetingMembership) leaveMeetingRoom(meetingMembership.meetingId);

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
