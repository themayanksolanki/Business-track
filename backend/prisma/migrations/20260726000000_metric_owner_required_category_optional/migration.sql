-- Backfill safety net — createMetric has always populated ownerId (defaulting
-- to the creator when not explicitly set), so this should be a no-op today,
-- but matches this repo's backfill-before-constrain convention.
UPDATE "metrics" SET "ownerId" = "createdById" WHERE "ownerId" IS NULL;

-- AlterTable
ALTER TABLE "metrics" ALTER COLUMN "categoryId" DROP NOT NULL;
ALTER TABLE "metrics" ALTER COLUMN "ownerId" SET NOT NULL;

-- Swap each FK's delete action to match its new nullability (optional ->
-- SET NULL, required -> RESTRICT), same convention Prisma already applies
-- elsewhere in this schema (e.g. Project.categoryId/createdById).
ALTER TABLE "metrics" DROP CONSTRAINT "metrics_categoryId_fkey";
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "metrics" DROP CONSTRAINT "metrics_ownerId_fkey";
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
