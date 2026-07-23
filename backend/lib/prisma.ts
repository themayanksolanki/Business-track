import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Local dev talks to a local Postgres instance; the deployed server (where
// the host sets NODE_ENV=production) talks to Supabase via DATABASE_URL.
const connectionString =
  process.env.NODE_ENV === 'production'
    ? process.env.DATABASE_URL
    : process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL;

const adapter = new PrismaPg({ connectionString: connectionString! });

const prisma = new PrismaClient({ adapter });

export default prisma;
