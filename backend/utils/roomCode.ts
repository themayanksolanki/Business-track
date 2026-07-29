import crypto from 'crypto';

// Excludes visually ambiguous characters (0/o, 1/l/i) since this code is
// meant to be read aloud/typed by a human joining a meeting.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const segment = (length: number) =>
  Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

// e.g. "abc-defg-hij" — short enough to share verbally, long enough
// (11 alphanumeric chars) that collisions are rare; callers should still
// retry on the `roomCode` unique-constraint violation (P2002).
export const generateRoomCode = () => `${segment(3)}-${segment(4)}-${segment(3)}`;
