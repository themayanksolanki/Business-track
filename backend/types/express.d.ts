import type { User as PrismaUser } from '@prisma/client';

// authMiddleware.js sets req.user to the authenticated row with the password
// field stripped — every controller/middleware downstream reads it assuming
// that shape.
declare global {
  namespace Express {
    interface Request {
      user?: Omit<PrismaUser, 'password'>;
    }
  }
}

export {};
