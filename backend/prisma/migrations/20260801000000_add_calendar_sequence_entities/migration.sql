-- AlterEnum
-- Only adds values (never uses them) — safe to do both in one migration,
-- unlike a migration that also inserted a row using the new value.
ALTER TYPE "SequenceEntity" ADD VALUE 'calendar';
ALTER TYPE "SequenceEntity" ADD VALUE 'calendarEvent';
