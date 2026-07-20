-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "pendingDeleteAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "attachmentCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "attachments_pendingDeleteAt_idx" ON "attachments"("pendingDeleteAt");

-- Backfill: existing tasks had attachments before this column existed.
UPDATE "tasks" t
SET "attachmentCount" = (
  SELECT COUNT(*) FROM "attachments" a WHERE a."taskId" = t.id
);
