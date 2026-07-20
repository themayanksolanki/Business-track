import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Mirrors lib/prisma.js: `prisma migrate dev`/`studio` run against the local
// Postgres instance unless NODE_ENV=production (set by the deploy host),
// in which case they target Supabase via DATABASE_URL.
const connectionString =
  process.env.NODE_ENV === 'production'
    ? process.env.DATABASE_URL
    : process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: connectionString,
  },
});
