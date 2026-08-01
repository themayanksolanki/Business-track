import { Server, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import type { CallType, CallStatus, MessageType } from '@prisma/client';
import prisma from './lib/prisma.js';
import { verifyRoomToken } from './utils/meetingToken.js';
import { GROUP_MESSAGE_INCLUDE } from './controllers/groupMessageController.js';

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
  'call:video': (payload: { callId: string; off: boolean }) => void;
  'call:screen-share': (payload: { callId: string; sharing: boolean }) => void;
  'call:mobile-device': (payload: { callId: string; mobile: boolean }) => void;
  'message:seen': (payload: { from: string | number }) => void;
  'group:message:send': (payload: {
    groupId: string | number;
    content?: string;
    type?: MessageType;
    fileUrl?: string;
    replyTo?: string | number;
  }) => void;
  'group:message:edit': (payload: { messageId: string | number; content?: string }) => void;
  'group:message:delete': (payload: { messageId: string | number; forAll?: boolean }) => void;
  'group:message:pin': (payload: { messageId: string | number; pinned?: boolean }) => void;
  'group:message:seen': (payload: { groupId: string | number }) => void;
  'group:typing:start': (payload: { groupId: string | number }) => void;
  'group:typing:stop': (payload: { groupId: string | number }) => void;
  'meeting:join': (payload: { roomToken: string }) => void;
  'meeting:leave': (payload: { meetingId: number }) => void;
  'meeting:signal': (payload: { meetingId: number; toSocketId: string; sdp?: unknown; candidate?: unknown }) => void;
  'meeting:mute': (payload: { meetingId: number; muted: boolean }) => void;
  'meeting:video-toggle': (payload: { meetingId: number; off: boolean }) => void;
  'meeting:screen-share': (payload: { meetingId: number; sharing: boolean }) => void;
  'meeting:hand-raise': (payload: { meetingId: number; raised: boolean }) => void;
  'meeting:mobile-device': (payload: { meetingId: number; mobile: boolean }) => void;
  'meeting:chat-message': (payload: { meetingId: number; message: string }) => void;
  'meeting:kick': (payload: { meetingId: number; targetSocketId: string }) => void;
  'meeting:end': (payload: { meetingId: number }) => void;
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

// meetingId → userIds the host has kicked — otherwise a kick has zero
// durable effect (the REST /join + socket meeting:join path has no other
// memory of it), letting a kicked user just immediately rejoin. Session-only
// by design (mesh WebRTC state itself is entirely in-memory too); cleared
// whenever the meeting ends, same lifetime as meetingSocketUsers.
const kickedFromMeeting = new Map<number, Set<number>>();

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
          prisma.user.findUnique({ where: { id: myId }, select: { organizationId: true } }),
          prisma.user.findUnique({ where: { id: toId }, select: { organizationId: true } }),
        ]);
        if (!recipient || recipient.organizationId !== me?.organizationId) {
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
    socket.on('call:video',          ({ callId, off })        => { const o = otherParty(callId); if (o) emitToUser(o, 'call:video',          { off, callId }); });
    socket.on('call:screen-share',   ({ callId, sharing })    => { const o = otherParty(callId); if (o) emitToUser(o, 'call:screen-share',   { sharing, callId }); });
    socket.on('call:mobile-device',  ({ callId, mobile })     => { const o = otherParty(callId); if (o) emitToUser(o, 'call:mobile-device',  { mobile, callId }); });

    // ── Meeting room signaling (N-way mesh) ─────────────────────────
    // First use of native Socket.IO rooms in this codebase — 1:1 calls above
    // route by userId via emitToUser instead. A meeting room needs broadcast
    // to an arbitrary number of members, which rooms give for free.

    // Same DB transaction the REST endMeeting controller runs — duplicated
    // rather than imported, since that handler needs an Express req/res and
    // this fires from a plain leave/disconnect with neither.
    const endMeetingRecord = async (meetingId: number) => {
      await prisma.$transaction([
        prisma.meeting.update({ where: { id: meetingId }, data: { status: 'ended', endedAt: new Date() } }),
        prisma.meetingParticipant.updateMany({ where: { meetingId, leftAt: null }, data: { leftAt: new Date() } }),
      ]);
      kickedFromMeeting.delete(meetingId);
    };

    // Ends the meeting once the room is empty — the host leaving while
    // other members (co-host or plain attendee, doesn't matter) are still on
    // the call does NOT end it; they keep talking.
    //
    // Waits a short grace period and re-checks before actually committing:
    // the room-emptiness check and the DB write are two separate ticks (the
    // write awaits a real transaction), so a same-user reconnect — a tab
    // refresh, a network blip — landing in that gap would otherwise get its
    // rejoin silently overwritten by a now-stale "ended" status. The delay
    // gives that reconnect time to land before the decision is finalized;
    // it doesn't fully close the window, just shrinks it to something a
    // real user's network hiccup will comfortably fit inside.
    const AUTO_END_GRACE_MS = 3000;
    const maybeAutoEndMeeting = (meetingId: number, room: string) => {
      if ((io.sockets.adapter.rooms.get(room)?.size ?? 0) > 0) return; // someone's still in it
      setTimeout(() => {
        void (async () => {
          try {
            if ((io.sockets.adapter.rooms.get(room)?.size ?? 0) > 0) return; // someone reconnected during the grace period
            await endMeetingRecord(meetingId);
          } catch { /* non-critical */ }
        })();
      }, AUTO_END_GRACE_MS);
    };

    const leaveMeetingRoom = (meetingId: number) => {
      const room = meetingRoom(meetingId);
      socket.leave(room);
      meetingSocketUsers.delete(socket.id);
      socket.to(room).emit('meeting:participant-left', { socketId: socket.id });
      void maybeAutoEndMeeting(meetingId, room);
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
      if (kickedFromMeeting.get(payload.meetingId)?.has(myId)) {
        socket.emit('meeting:join-error', { message: 'You have been removed from this meeting.' });
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

    socket.on('meeting:screen-share', ({ meetingId, sharing }) => {
      const room = meetingRoom(meetingId);
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('meeting:screen-share', { socketId: socket.id, sharing });
    });

    socket.on('meeting:hand-raise', ({ meetingId, raised }) => {
      const room = meetingRoom(meetingId);
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('meeting:hand-raise', { socketId: socket.id, raised });
    });

    socket.on('meeting:mobile-device', ({ meetingId, mobile }) => {
      const room = meetingRoom(meetingId);
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('meeting:mobile-device', { socketId: socket.id, mobile });
    });

    // Ephemeral, in-room only — never persisted (distinct from the real
    // Group/DM chat, which is Message/GroupMessage rows). Echoed to the
    // sender too (io.to, not socket.to) so their own panel shows it in the
    // same order as everyone else's, rather than optimistically local-only.
    socket.on('meeting:chat-message', ({ meetingId, message }) => {
      const room = meetingRoom(meetingId);
      if (!socket.rooms.has(room)) return;
      const trimmed = (message || '').slice(0, 2000).trim();
      if (!trimmed) return;
      io.to(room).emit('meeting:chat-message', {
        socketId: socket.id,
        userId: myId,
        message: trimmed,
        at: new Date().toISOString(),
      });
    });

    // Host-only — re-verified against the DB rather than trusted from the
    // client, unlike the state-broadcast events above (mute/hand-raise/etc.)
    // which only ever reflect the caller's own state and can't affect anyone
    // else's session even if spoofed.
    socket.on('meeting:kick', async ({ meetingId, targetSocketId }) => {
      const room = meetingRoom(meetingId);
      if (!socket.rooms.has(room)) return;
      const meeting = await prisma.meeting.findUnique({ where: { id: Number(meetingId) }, select: { hostId: true } });
      if (!meeting || meeting.hostId !== myId) return;

      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket || !targetSocket.rooms.has(room)) return;

      // Recorded BEFORE removing the socketId→userId mapping below — a kick
      // that only drops the socket has no durable effect otherwise, since
      // nothing stops the same user immediately re-requesting a room token
      // and rejoining. See kickedFromMeeting's own comment.
      const targetUserId = meetingSocketUsers.get(targetSocketId)?.userId;
      if (targetUserId !== undefined) {
        const kicked = kickedFromMeeting.get(Number(meetingId)) ?? new Set<number>();
        kicked.add(targetUserId);
        kickedFromMeeting.set(Number(meetingId), kicked);
      }

      targetSocket.leave(room);
      meetingSocketUsers.delete(targetSocketId);
      targetSocket.emit('meeting:kicked');
      socket.to(room).emit('meeting:participant-left', { socketId: targetSocketId });
    });

    // Host, co-host, or org Admin — re-verified against the DB, mirroring
    // canEndMeeting exactly (meetingController.ts) so this broadcast can
    // never be narrower than who the REST endMeeting endpoint actually
    // allows to end the meeting. It used to check host-only, which meant a
    // co-host/Admin ending the meeting via REST correctly flipped the DB but
    // then had this socket relay silently dropped — everyone else's client
    // sat in a "live" call that was already 'ended' underneath them. The
    // REST PATCH-style status flip already happened via POST
    // /meetings/:id/end before the client emits this — this is purely the
    // real-time "everyone leave now" fan-out, including back to the
    // initiator's own socket, so a single meeting:ended$ subscription
    // handles cleanup/navigation identically for every participant.
    socket.on('meeting:end', async ({ meetingId }) => {
      const room = meetingRoom(meetingId);
      if (!socket.rooms.has(room)) return;
      const meeting = await prisma.meeting.findUnique({
        where: { id: Number(meetingId) },
        select: { hostId: true, organizationId: true, participants: { select: { userId: true, role: true } } },
      });
      if (!meeting) return;
      const me = await prisma.user.findUnique({ where: { id: myId }, select: { role: true, organizationId: true } });
      if (!me || me.organizationId !== meeting.organizationId) return;

      const isHost = meeting.hostId === myId;
      const isCoHost = meeting.participants.some((p) => p.userId === myId && p.role === 'coHost');
      const isAdmin = me.role === 'Admin';
      if (!isHost && !isCoHost && !isAdmin) return;

      io.to(room).emit('meeting:ended');
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

    // ── Group chat messages ─────────────────────────────────────────
    // Fans out via emitToUser per member, same as 1:1 messages above —
    // deliberately not a Socket.IO room (unlike the meeting-room section
    // below): groups are persistent, membership-gated conversations, not an
    // ephemeral N-way media session, so this mirrors the existing message:*
    // pattern generalized to N recipients instead of introducing a second
    // real-time model.
    const groupMemberIds = (groupId: number) =>
      prisma.groupMember.findMany({ where: { groupId }, select: { userId: true } }).then((rows) => rows.map((r) => r.userId));

    const isGroupMember = (groupId: number) =>
      prisma.groupMember
        .findUnique({ where: { groupId_userId: { groupId, userId: myId } } })
        .then((m) => !!m);

    socket.on('group:message:send', async ({ groupId, content, type, fileUrl, replyTo }) => {
      try {
        const gid = Number(groupId);
        if (!(await isGroupMember(gid))) {
          socket.emit('group:message:error', 'You are not a member of this group.');
          return;
        }

        const msg = await prisma.groupMessage.create({
          data: {
            groupId: gid,
            senderId: myId,
            content: content || '',
            type: type || 'text',
            fileUrl: fileUrl || null,
            replyToId: replyTo ? Number(replyTo) : null,
          },
          include: GROUP_MESSAGE_INCLUDE,
        });
        // The sender has implicitly seen their own message.
        await prisma.groupMessageRead.create({ data: { groupMessageId: msg.id, userId: myId } });

        emitToUser(userId, 'group:message:sent', msg);
        const memberIds = await groupMemberIds(gid);
        memberIds.filter((id) => id !== myId).forEach((id) => emitToUser(id, 'group:message:receive', msg));
      } catch (err: any) {
        socket.emit('group:message:error', err.message);
      }
    });

    socket.on('group:message:edit', async ({ messageId, content }) => {
      try {
        const msg = await prisma.groupMessage.findUnique({ where: { id: Number(messageId) } });
        if (!msg || msg.senderId !== myId || msg.type !== 'text' || msg.isDeleted) return;

        const updated = await prisma.groupMessage.update({
          where: { id: msg.id },
          data: { content: content || '', isEdited: true, editedAt: new Date() },
          include: GROUP_MESSAGE_INCLUDE,
        });
        const memberIds = await groupMemberIds(msg.groupId);
        memberIds.forEach((id) => emitToUser(id, 'group:message:edited', updated));
      } catch (err: any) {
        socket.emit('group:message:error', err.message);
      }
    });

    socket.on('group:message:delete', async ({ messageId, forAll }) => {
      try {
        const msg = await prisma.groupMessage.findUnique({ where: { id: Number(messageId) } });
        if (!msg || !(await isGroupMember(msg.groupId))) return;

        if (forAll) {
          if (msg.senderId !== myId) return;
          if (Date.now() - msg.createdAt.getTime() > DELETE_FOR_ALL_WINDOW_MS) {
            socket.emit('group:message:error', 'Delete for everyone is only available within 2 hours of sending.');
            return;
          }
          await prisma.groupMessage.update({
            where: { id: msg.id },
            data: { isDeleted: true, content: '', fileUrl: null },
          });
          const memberIds = await groupMemberIds(msg.groupId);
          memberIds.forEach((id) => emitToUser(id, 'group:message:deleted', { messageId, forAll: true }));
        } else {
          await prisma.groupMessage.update({
            where: { id: msg.id },
            data: { deletedFor: { connect: { id: myId } } },
          });
          socket.emit('group:message:deleted', { messageId, forAll: false });
        }
      } catch (err: any) {
        socket.emit('group:message:error', err.message);
      }
    });

    socket.on('group:message:pin', async ({ messageId, pinned }) => {
      try {
        const msg = await prisma.groupMessage.findUnique({ where: { id: Number(messageId) } });
        if (!msg || !(await isGroupMember(msg.groupId))) return;

        const updated = await prisma.groupMessage.update({ where: { id: msg.id }, data: { isPinned: !!pinned } });
        const memberIds = await groupMemberIds(msg.groupId);
        memberIds.forEach((id) => emitToUser(id, 'group:message:pinned', { messageId, pinned: updated.isPinned }));
      } catch (err: any) {
        socket.emit('group:message:error', err.message);
      }
    });

    socket.on('group:message:seen', async ({ groupId }) => {
      try {
        const gid = Number(groupId);
        if (!(await isGroupMember(gid))) return;

        const unread = await prisma.groupMessage.findMany({
          where: { groupId: gid, senderId: { not: myId }, reads: { none: { userId: myId } } },
          select: { id: true },
        });
        if (unread.length) {
          await prisma.groupMessageRead.createMany({
            data: unread.map((m) => ({ groupMessageId: m.id, userId: myId })),
            skipDuplicates: true,
          });
        }
        const memberIds = await groupMemberIds(gid);
        memberIds.filter((id) => id !== myId).forEach((id) => emitToUser(id, 'group:message:seen', { groupId: gid, by: userId }));
      } catch { /* non-critical */ }
    });

    socket.on('group:typing:start', async ({ groupId }) => {
      const gid = Number(groupId);
      if (!(await isGroupMember(gid))) return;
      const memberIds = await groupMemberIds(gid);
      memberIds.filter((id) => id !== myId).forEach((id) => emitToUser(id, 'group:typing:update', { groupId: gid, from: userId, isTyping: true }));
    });
    socket.on('group:typing:stop', async ({ groupId }) => {
      const gid = Number(groupId);
      if (!(await isGroupMember(gid))) return;
      const memberIds = await groupMemberIds(gid);
      memberIds.filter((id) => id !== myId).forEach((id) => emitToUser(id, 'group:typing:update', { groupId: gid, from: userId, isTyping: false }));
    });

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
