-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'EUR', 'JPY', 'GBP', 'CNY', 'INR');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'USD';
