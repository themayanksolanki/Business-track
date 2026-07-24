-- CreateEnum
CREATE TYPE "MeasurementUnit" AS ENUM ('KG', 'LB', 'LTR');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "unit" "MeasurementUnit" NOT NULL DEFAULT 'KG';
