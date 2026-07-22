-- AlterEnum
-- Postgres requires ALTER TYPE ... ADD VALUE to not run in the same
-- transaction as a statement that uses the new value — harmless here since
-- nothing else in this file references 'mentioned'.
ALTER TYPE "NotificationType" ADD VALUE 'mentioned';

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "mentions" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "project_items" ADD COLUMN     "mentions" JSONB NOT NULL DEFAULT '[]';
