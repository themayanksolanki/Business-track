-- AlterTable
ALTER TABLE "meeting_settings" ADD COLUMN     "allowExternalGuests" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "meeting_guests" (
    "id" SERIAL NOT NULL,
    "meetingId" INTEGER NOT NULL,
    "guestKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "meeting_guests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_guests_meetingId_idx" ON "meeting_guests"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_guests_meetingId_guestKey_key" ON "meeting_guests"("meetingId", "guestKey");

-- AddForeignKey
ALTER TABLE "meeting_guests" ADD CONSTRAINT "meeting_guests_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
