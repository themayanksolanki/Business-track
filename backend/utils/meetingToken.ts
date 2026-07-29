import jwt from 'jsonwebtoken';

export interface RoomTokenPayload {
  meetingId: number;
  userId: number;
}

// Short-lived, room-scoped token handed out by POST /api/meetings/:id/join —
// used only to authenticate the socket handshake into the meeting:{id} room,
// separate from the long-lived session access token (authController.ts).
export const signRoomToken = (meetingId: number, userId: number) =>
  jwt.sign({ meetingId, userId }, process.env.JWT_SECRET!, { expiresIn: '2m' });

export const verifyRoomToken = (token: string): RoomTokenPayload =>
  jwt.verify(token, process.env.JWT_SECRET!) as RoomTokenPayload;
