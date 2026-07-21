-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('file', 'link');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "kind" "AttachmentKind" NOT NULL DEFAULT 'file';
