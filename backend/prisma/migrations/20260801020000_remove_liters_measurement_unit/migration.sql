-- Liters was never a weight unit (KG/LB are; LTR is volume) — dropping it
-- from MeasurementUnit. Postgres can't drop an enum value directly, so the
-- type is recreated without it. Any user already on LTR is reassigned to
-- the column default (KG) first so the column swap doesn't fail.
UPDATE "users" SET "unit" = 'KG' WHERE "unit" = 'LTR';

ALTER TYPE "MeasurementUnit" RENAME TO "MeasurementUnit_old";
CREATE TYPE "MeasurementUnit" AS ENUM ('KG', 'LB');
ALTER TABLE "users" ALTER COLUMN "unit" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "unit" TYPE "MeasurementUnit" USING ("unit"::text::"MeasurementUnit");
ALTER TABLE "users" ALTER COLUMN "unit" SET DEFAULT 'KG';
DROP TYPE "MeasurementUnit_old";
