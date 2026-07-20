-- CreateEnum
CREATE TYPE "DateFormat" AS ENUM ('DD_MM_YYYY', 'MM_DD_YYYY', 'YYYY_MM_DD', 'DD_MMM_YY');

-- CreateEnum
CREATE TYPE "TimeFormat" AS ENUM ('HOUR_12', 'HOUR_24');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dateFormat" "DateFormat" NOT NULL DEFAULT 'MM_DD_YYYY',
ADD COLUMN     "timeFormat" "TimeFormat" NOT NULL DEFAULT 'HOUR_12';
