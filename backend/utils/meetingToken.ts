import jwt from 'jsonwebtoken';

export interface UserRoomTokenPayload {
  kind: 'user';
  meetingId: number;
  userId: number;
}

export interface GuestRoomTokenPayload {
  kind: 'guest';
  meetingId: number;
  guestId: number;
  displayName: string;
}

export type RoomTokenPayload = UserRoomTokenPayload | GuestRoomTokenPayload;

// Short-lived, room-scoped token handed out by POST /api/meetings/:id/join —
// used only to authenticate the socket handshake into the meeting:{id} room,
// separate from the long-lived session access token (authController.ts). A
// real user already has that long-lived token authenticating their socket
// connection app-wide, so this only needs to live long enough to be handed
// straight to socketSvc.joinMeetingRoom() right after REST join succeeds.
export const signRoomToken = (meetingId: number, userId: number) =>
  jwt.sign({ kind: 'user', meetingId, userId } satisfies UserRoomTokenPayload, process.env.JWT_SECRET!, {
    expiresIn: '2m',
  });

// A guest has no long-lived session token at all — this one doubles as
// their Socket.IO handshake credential for the whole call (see socket.ts's
// io.use), not just a short hand-off, hence the much longer expiry than
// signRoomToken above.
export const signGuestSessionToken = (meetingId: number, guestId: number, displayName: string) =>
  jwt.sign(
    { kind: 'guest', meetingId, guestId, displayName } satisfies GuestRoomTokenPayload,
    process.env.JWT_SECRET!,
    { expiresIn: '6h' }
  );

export const verifyRoomToken = (token: string): RoomTokenPayload =>
  jwt.verify(token, process.env.JWT_SECRET!) as RoomTokenPayload;
