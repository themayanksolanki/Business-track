import type { Prisma } from '@prisma/client';
import { getOrCreateDefaultCalendar } from '../controllers/eventController.js';
import { nextSequenceId } from '../utils/sequence.js';
import { detectMeetingPlatform } from '../utils/meetingLink.js';

// A new meeting link only ever carries a single point in time (no end),
// unlike a real CalendarEvent — this fallback duration backs the mirrored
// event's `end` when no duration was picked (legacy links saved before this
// field existed) so it still renders as a normal (non-zero-length) block.
const MEETING_EVENT_DURATION_MINUTES = 30;

interface MeetingLinkItem {
  id: number;
  title: string;
  organizationId: number | null;
  assignedToId: number | null;
  createdById: number;
}

interface MeetingLinkChange {
  url: string | null;
  title: string | null;
  at: Date | null;
  durationMinutes: number | null;
}

// Keeps a ProjectItem's pasted meeting link (see projectItemController.ts'
// updateItem, the only writer of meetingLinkUrl/Title/At) mirrored onto
// exactly one auto-managed CalendarEvent (CalendarEvent.sourceProjectItemId,
// @unique) — created the first time a link+time is set, updated in place on
// further edits (including reusing the row if a link is re-added after
// removal), and soft-cancelled — never deleted — when the link is removed,
// so the event keeps surfacing on the calendar as an explicit cancellation
// instead of silently vanishing. Must run inside the same transaction as the
// ProjectItem write it's syncing from.
//
// `description` is deliberately left untouched (never set here) — it's a
// free-text field users edit directly via the event modal's CKEditor, and
// used to get clobbered with a canned "Automatically created from..."
// string on every meeting-link edit. Instead, the originating task is
// connected into the event's `linkedTasks` (the same many-to-many the
// event's "Tasks" tab uses), so it simply shows up there.
export async function syncMeetingLinkCalendarEvent(
  tx: Prisma.TransactionClient,
  item: MeetingLinkItem,
  change: MeetingLinkChange,
  actorId: number
) {
  const existing = await tx.calendarEvent.findUnique({
    where: { sourceProjectItemId: item.id },
    include: { linkedTasks: { select: { id: true } } },
  });

  if (!change.url) {
    if (existing && existing.status !== 'cancelled') {
      await tx.calendarEvent.update({
        where: { id: existing.id },
        data: { status: 'cancelled', updatedById: actorId },
      });
    }
    return;
  }

  const start = change.at ?? new Date();
  const durationMinutes = change.durationMinutes ?? MEETING_EVENT_DURATION_MINUTES;
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const platform = detectMeetingPlatform(change.url);
  const title = change.title || 'Meeting';

  if (existing) {
    const alreadyLinked = existing.linkedTasks.some((t) => t.id === item.id);
    await tx.calendarEvent.update({
      where: { id: existing.id },
      data: {
        title,
        start,
        end,
        meetingLinkUrl: change.url,
        meetingLinkTitle: change.title,
        meetingLinkPlatform: platform,
        status: 'confirmed',
        updatedById: actorId,
        ...(alreadyLinked ? {} : { linkedTasks: { connect: [{ id: item.id }] } }),
      },
    });
    return;
  }

  const ownerId = item.assignedToId ?? item.createdById;
  const calendar = await getOrCreateDefaultCalendar(tx, { id: ownerId, organizationId: item.organizationId });
  const sequenceId = await nextSequenceId(tx, item.organizationId, 'calendarEvent');

  await tx.calendarEvent.create({
    data: {
      organizationId: item.organizationId,
      sequenceId,
      title,
      start,
      end,
      allDay: false,
      ownerId,
      calendarId: calendar.id,
      meetingLinkUrl: change.url,
      meetingLinkTitle: change.title,
      meetingLinkPlatform: platform,
      status: 'confirmed',
      sourceProjectItemId: item.id,
      createdById: actorId,
      linkedTasks: { connect: [{ id: item.id }] },
    },
  });
}
