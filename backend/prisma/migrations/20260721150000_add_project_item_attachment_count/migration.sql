-- AlterTable
ALTER TABLE "project_items" ADD COLUMN     "attachmentCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing project items had attachments before this column existed.
UPDATE "project_items" t
SET "attachmentCount" = (
  SELECT COUNT(*) FROM "attachments" a WHERE a."projectItemId" = t.id
);
