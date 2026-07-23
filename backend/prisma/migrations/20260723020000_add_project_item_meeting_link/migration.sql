-- CreateEnum
CREATE TYPE "MeetingPlatform" AS ENUM ('ZOOM', 'GOOGLE_MEET', 'TEAMS', 'WEBEX', 'OTHER');

-- AlterTable
ALTER TABLE "project_items" ADD COLUMN     "meetingLinkUrl" TEXT,
ADD COLUMN     "meetingLinkTitle" TEXT,
ADD COLUMN     "meetingLinkPlatform" "MeetingPlatform",
ADD COLUMN     "meetingLinkAt" TIMESTAMP(3);
