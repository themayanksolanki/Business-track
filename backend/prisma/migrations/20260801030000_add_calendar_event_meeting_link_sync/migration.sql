-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('confirmed', 'cancelled');

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN "status" "CalendarEventStatus" NOT NULL DEFAULT 'confirmed';
ALTER TABLE "calendar_events" ADD COLUMN "sourceProjectItemId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_sourceProjectItemId_key" ON "calendar_events"("sourceProjectItemId");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_sourceProjectItemId_fkey" FOREIGN KEY ("sourceProjectItemId") REFERENCES "project_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
