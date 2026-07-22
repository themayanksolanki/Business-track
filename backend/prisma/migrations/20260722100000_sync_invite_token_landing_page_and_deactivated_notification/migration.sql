-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'userDeactivated';

-- AlterTable
ALTER TABLE "invites" ADD COLUMN     "token" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "defaultLandingPage" TEXT NOT NULL DEFAULT 'dashboard';

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");

