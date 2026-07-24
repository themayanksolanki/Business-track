-- CreateEnum
CREATE TYPE "ExceptionAction" AS ENUM ('skip', 'modified');

-- CreateTable
CREATE TABLE "event_exceptions" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "originalStart" TIMESTAMP(3) NOT NULL,
    "action" "ExceptionAction" NOT NULL,
    "overrideEventId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_exceptions_overrideEventId_key" ON "event_exceptions"("overrideEventId");
CREATE INDEX "event_exceptions_eventId_idx" ON "event_exceptions"("eventId");
CREATE UNIQUE INDEX "event_exceptions_eventId_originalStart_key" ON "event_exceptions"("eventId", "originalStart");

-- AddForeignKey
ALTER TABLE "event_exceptions" ADD CONSTRAINT "event_exceptions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_exceptions" ADD CONSTRAINT "event_exceptions_overrideEventId_fkey" FOREIGN KEY ("overrideEventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
