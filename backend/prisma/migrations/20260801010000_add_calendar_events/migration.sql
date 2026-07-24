-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('daily', 'weekly', 'monthly', 'yearly');

-- CreateEnum
CREATE TYPE "GuestRsvpStatus" AS ENUM ('pending', 'accepted', 'declined', 'tentative');

-- CreateEnum
CREATE TYPE "ReminderMethod" AS ENUM ('notification', 'email');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('standard', 'private', 'public');

-- CreateEnum
CREATE TYPE "EventBusyStatus" AS ENUM ('busy', 'free');

-- CreateTable
CREATE TABLE "calendars" (
    "id" SERIAL NOT NULL,
    "sequenceId" INTEGER,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "ownerId" INTEGER NOT NULL,
    "organizationId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "organizationId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_rules" (
    "id" SERIAL NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "byWeekday" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "count" INTEGER,
    "until" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" SERIAL NOT NULL,
    "sequenceId" INTEGER,
    "organizationId" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "categoryId" INTEGER,
    "ownerId" INTEGER NOT NULL,
    "calendarId" INTEGER NOT NULL,
    "meetingLinkUrl" TEXT,
    "meetingLinkTitle" TEXT,
    "meetingLinkPlatform" "MeetingPlatform",
    "visibility" "EventVisibility" NOT NULL DEFAULT 'standard',
    "busyStatus" "EventBusyStatus" NOT NULL DEFAULT 'busy',
    "recurrenceId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_guests" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "userId" INTEGER,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "rsvp" "GuestRsvpStatus" NOT NULL DEFAULT 'pending',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "event_guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_reminders" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "method" "ReminderMethod" NOT NULL DEFAULT 'notification',
    "minutesBefore" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendars_ownerId_idx" ON "calendars"("ownerId");
CREATE INDEX "calendars_organizationId_idx" ON "calendars"("organizationId");
CREATE UNIQUE INDEX "calendars_organizationId_sequenceId_key" ON "calendars"("organizationId", "sequenceId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_categories_organizationId_name_key" ON "calendar_categories"("organizationId", "name");
CREATE INDEX "calendar_categories_organizationId_idx" ON "calendar_categories"("organizationId");

-- CreateIndex
CREATE INDEX "calendar_events_organizationId_idx" ON "calendar_events"("organizationId");
CREATE INDEX "calendar_events_calendarId_idx" ON "calendar_events"("calendarId");
CREATE INDEX "calendar_events_ownerId_start_idx" ON "calendar_events"("ownerId", "start");
CREATE UNIQUE INDEX "calendar_events_organizationId_sequenceId_key" ON "calendar_events"("organizationId", "sequenceId");
CREATE UNIQUE INDEX "calendar_events_recurrenceId_key" ON "calendar_events"("recurrenceId");

-- CreateIndex
CREATE INDEX "event_guests_eventId_idx" ON "event_guests"("eventId");
CREATE UNIQUE INDEX "event_guests_eventId_email_key" ON "event_guests"("eventId", "email");

-- CreateIndex
CREATE INDEX "event_reminders_eventId_idx" ON "event_reminders"("eventId");

-- AddForeignKey
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_categories" ADD CONSTRAINT "calendar_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_categories" ADD CONSTRAINT "calendar_categories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_categories" ADD CONSTRAINT "calendar_categories_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "calendar_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "recurring_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_guests" ADD CONSTRAINT "event_guests_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_guests" ADD CONSTRAINT "event_guests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
