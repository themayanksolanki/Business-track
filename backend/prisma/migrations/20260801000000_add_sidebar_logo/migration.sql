-- CreateEnum
CREATE TYPE "SidebarLogo" AS ENUM ('CHECK', 'ROCKET', 'BOLT', 'STAR', 'SHIELD', 'DIAMOND');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sidebarLogo" "SidebarLogo" NOT NULL DEFAULT 'CHECK';
