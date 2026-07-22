-- AlterTable
ALTER TABLE "project_roles" ADD COLUMN     "canEdit" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: the "Viewer" default role was seeded before this column existed
-- (defaulting to true like everything else) — correct it to view-only now.
UPDATE "project_roles" SET "canEdit" = false WHERE "title" = 'Viewer' AND "isDefault" = true;
