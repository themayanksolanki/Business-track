import jwt from 'jsonwebtoken';
// Short-lived, room-scoped token handed out by POST /api/meetings/:id/join —
// used only to authenticate the socket handshake into the meeting:{id} room,
// separate from the long-lived session access token (authController.ts).
export const signRoomToken = (meetingId, userId) => jwt.sign({ meetingId, userId }, process.env.JWT_SECRET, { expiresIn: '2m' });
export const verifyRoomToken = (token) => jwt.verify(token, process.env.JWT_SECRET);
//# sourceMappingURL=meetingToken.js.map