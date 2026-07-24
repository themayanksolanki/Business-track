-- AlterTable
ALTER TABLE "attachments" ADD COLUMN "calendarEventId" INTEGER;

-- CreateIndex
CREATE INDEX "attachments_calendarEventId_idx" ON "attachments"("calendarEventId");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
