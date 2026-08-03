-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'USD';
ALTER TABLE "organizations" ADD COLUMN "unit" "MeasurementUnit" NOT NULL DEFAULT 'KG';

-- Backfill: carry each existing org's creator's prior currency/unit forward
-- onto the new org-level column, before that source data is dropped below.
UPDATE "organizations" o
SET "currency" = u."currency", "unit" = u."unit"
FROM "users" u
WHERE u."id" = o."createdById";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "currency";
ALTER TABLE "users" DROP COLUMN "unit";
