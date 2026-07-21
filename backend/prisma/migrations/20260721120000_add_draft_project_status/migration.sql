-- AlterEnum
-- Postgres forbids using a newly-added enum value in the same transaction
-- that adds it, so this migration does nothing else — later migrations (and
-- the application) can freely use 'draft' once this one has committed.
ALTER TYPE "ProjectStatus" ADD VALUE 'draft';
