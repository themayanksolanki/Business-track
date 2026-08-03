/**
 * Run once: node backend/scripts/backfillMeetingLinkCalendarEvents.js
 *
 * Migration 20260801030000_add_calendar_event_meeting_link_sync added
 * CalendarEvent.sourceProjectItemId but didn't backfill it: syncMeetingLinkCalendarEvent
 * (meetingLinkCalendarSync.service.ts) only ever runs from projectItemController.updateItem's
 * write path, so any ProjectItem whose meeting link was set before that migration shipped
 * (fields have existed since 20260723020000_add_project_item_meeting_link, 9 days earlier)
 * never got its mirrored CalendarEvent. This creates it now, as if the link were being
 * saved for the first time today.
 */
import prisma from '../lib/prisma.js';
import { syncMeetingLinkCalendarEvent } from '../services/meetingLinkCalendarSync.service.js';

const items = await prisma.projectItem.findMany({
  where: { meetingLinkUrl: { not: null }, meetingCalendarEvent: { is: null } },
  select: {
    id: true,
    title: true,
    organizationId: true,
    assignedToId: true,
    createdById: true,
    updatedById: true,
    meetingLinkUrl: true,
    meetingLinkTitle: true,
    meetingLinkAt: true,
    meetingLinkDurationMinutes: true,
  },
});

let migrated = 0;
for (const item of items) {
  await prisma.$transaction((tx) =>
    syncMeetingLinkCalendarEvent(
      tx,
      item,
      {
        url: item.meetingLinkUrl,
        title: item.meetingLinkTitle,
        at: item.meetingLinkAt,
        durationMinutes: item.meetingLinkDurationMinutes,
      },
      item.updatedById ?? item.createdById
    )
  );
  migrated++;
}

console.log(`Backfilled ${migrated} meeting-link calendar event(s) for pre-existing project items.`);
await prisma.$disconnect();
