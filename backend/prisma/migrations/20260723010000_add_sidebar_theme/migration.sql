-- CreateEnum
CREATE TYPE "SidebarTheme" AS ENUM ('MIDNIGHT', 'CHARCOAL', 'OCEAN', 'FOREST', 'PLUM', 'DAYLIGHT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sidebarTheme" "SidebarTheme" NOT NULL DEFAULT 'MIDNIGHT',
ADD COLUMN     "sidebarTextColor" TEXT;
