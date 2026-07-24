-- CreateEnum
CREATE TYPE "MetricDataType" AS ENUM ('number', 'weight', 'currency', 'percentage');

-- AlterTable
ALTER TABLE "metrics" ADD COLUMN "dataType" "MetricDataType" NOT NULL DEFAULT 'number';
