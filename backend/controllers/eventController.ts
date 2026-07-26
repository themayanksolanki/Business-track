import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { destroyBlob } from '../utils/blobStorage.js';
import { detectMeetingPlatform } from '../utils/meetingLink.js';
import { nextSequenceId } from '../utils/sequence.js';
import { generateOccurrences, isGeneratedOccurrence } from '../utils/recurrence.js';

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };

const EVENT_INCLUDE = {
  department: { select: { id: true, name: true, color: true } },
  category: { select: { id: true, name: true, color: true } },
  owner: { select: USER_SELECT },
  calendar: { select: { id: true, name: true, color: true } },
  createdBy: { select: USER_SELECT },
  updatedBy: { select: USER_SELECT },
  recurrence: true,
  guests: { include: { user: { select: USER_SELECT } } },
  reminders: true,
  attachments: true,
};

// Lightweight include for the list view — no separate "light" list endpoint
// was asked for, but the full EVENT_INCLUDE's guests/attachments/reminders
// joins aren't needed to paint a month/week/day grid, mirroring how
// metricController.ts keeps METRIC_LIST_INCLUDE separate from METRIC_INCLUDE.
const EVENT_LIST_INCLUDE = {
  department: { select: { id: true, name: true, color: true } },
  category: { select: { id: true, name: true, color: true } },
  owner: { select: USER_SELECT },
  calendar: { select: { id: true, name: true, color: true } },
  guests: { select: { id: true, email: true, name: true, rsvp: true, userId: true } },
  // Needed to expand a recurring master into occurrences (see
  // expandEventsToOccurrences) — small enough (one row, five scalar fields)
  // that it doesn't warrant its own even-lighter include shape.
  recurrence: true,
};

export type AuthUser = { id: number; role: string; organizationId: number | null };

interface EventForAccess {
  organizationId: number | null;
  ownerId: number;
  visibility: string;
  guests: { userId: number | null }[];
}

// A user can see an event if they're the owner, an invited guest, the event
// is marked 'public', or they're an Admin — 'standard'/'private' otherwise
// stay visible only to the owner/guests.
export const canAccessEvent = (user: AuthUser, event: EventForAccess) => {
  if (event.organizationId !== user.organizationId) return false;
  if (user.role === 'Admin') return true;
  if (event.ownerId === user.id) return true;
  if (event.guests.some((g) => g.userId === user.id)) return true;
  if (event.visibility === 'public') return true;
  return false;
};

// Guests can RSVP (not built in this pass) but never edit/delete the event
// itself — only the owner or an Admin can.
export const canEditEvent = (user: AuthUser, event: { ownerId: number }) =>
  user.role === 'Admin' || event.ownerId === user.id;

// No Calendar-management endpoints exist yet — this lazily provisions a
// user's first Calendar the first time they create an event without
// specifying one, so createEvent doesn't hard-depend on a separate feature
// that hasn't been built. Must run inside the same transaction as the event
// create so the two commit/rollback together.
async function getOrCreateDefaultCalendar(tx: Prisma.TransactionClient, user: AuthUser) {
  const existing = await tx.calendar.findFirst({ where: { ownerId: user.id }, orderBy: { id: 'asc' } });
  if (existing) return existing;

  const sequenceId = await nextSequenceId(tx, user.organizationId, 'calendar');
  return tx.calendar.create({
    data: {
      name: 'My Calendar',
      ownerId: user.id,
      createdById: user.id,
      organizationId: user.organizationId,
      sequenceId,
    },
  });
}

export const canAccessCalendar = (user: AuthUser, calendar: { ownerId: number; organizationId: number | null }) =>
  calendar.organizationId === user.organizationId && (user.role === 'Admin' || calendar.ownerId === user.id);

interface GuestInput {
  email: string;
  name?: string | null;
  userId?: number | null;
}

interface ReminderInput {
  method?: 'notification' | 'email';
  minutesBefore?: number;
}

interface RecurrenceInput {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  byWeekday?: number[];
  count?: number | null;
  until?: string | null;
}

const guestsCreateData = (guests: GuestInput[]) =>
  guests.map((g) => ({
    email: g.email.trim().toLowerCase(),
    name: g.name || null,
    userId: g.userId ? Number(g.userId) : null,
  }));

const remindersCreateData = (reminders: ReminderInput[]) =>
  reminders.map((r) => ({
    method: r.method ?? 'notification',
    minutesBefore: r.minutesBefore ?? 10,
  }));

const recurrenceCreateData = (recurrence: RecurrenceInput) => ({
  frequency: recurrence.frequency,
  interval: recurrence.interval ?? 1,
  byWeekday: recurrence.byWeekday ?? [],
  count: recurrence.count ?? null,
  until: recurrence.until ? new Date(recurrence.until) : null,
});

// Fans a page of raw CalendarEvent rows out into display-ready occurrences:
// non-recurring rows pass through as a single occurrence of themselves,
// recurring masters get expanded via generateOccurrences with any
// EventException applied (skip omits the slot, modified substitutes the
// override event's fields). Only expands when both range bounds are given —
// a recurring rule has no natural stopping point to expand against
// otherwise, so those rows just pass through unexpanded too.
async function expandEventsToOccurrences(
  events: Array<Prisma.CalendarEventGetPayload<{ include: typeof EVENT_LIST_INCLUDE }>>,
  rangeStart: Date | null,
  rangeEnd: Date | null
) {
  const nonRecurring = events.filter((e) => e.recurrenceId == null);
  const recurringMasters = events.filter((e) => e.recurrenceId != null);

  const nonRecurringItems = nonRecurring.map((e) => ({
    ...e,
    isRecurring: false,
    isException: false,
    originalStart: e.start.toISOString(),
  }));

  if (!rangeStart || !rangeEnd || !recurringMasters.length) {
    const unexpanded = recurringMasters.map((e) => ({
      ...e,
      isRecurring: true,
      isException: false,
      originalStart: e.start.toISOString(),
    }));
    return [...nonRecurringItems, ...unexpanded].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }

  const exceptions = await prisma.eventException.findMany({
    where: { eventId: { in: recurringMasters.map((e) => e.id) } },
    include: { overrideEvent: { include: EVENT_LIST_INCLUDE } },
  });
  const exceptionsByEventId = new Map<number, typeof exceptions>();
  for (const ex of exceptions) {
    const list = exceptionsByEventId.get(ex.eventId) ?? [];
    list.push(ex);
    exceptionsByEventId.set(ex.eventId, list);
  }

  const occurrenceItems: Record<string, unknown>[] = [];
  for (const master of recurringMasters) {
    if (!master.recurrence) continue; // recurrenceId set implies this exists; defensive only
    const bySlot = new Map((exceptionsByEventId.get(master.id) ?? []).map((ex) => [ex.originalStart.getTime(), ex]));

    const rawOccurrences = generateOccurrences(master.recurrence, master.start, master.end, rangeStart, rangeEnd);

    for (const occ of rawOccurrences) {
      const exception = bySlot.get(occ.originalStart.getTime());
      if (exception?.action === 'skip') continue;

      const isException = exception?.action === 'modified' && !!exception.overrideEvent;
      const source = isException ? exception!.overrideEvent! : master;

      occurrenceItems.push({
        ...source,
        id: master.id,
        sequenceId: master.sequenceId,
        start: isException ? source.start : occ.start,
        end: isException ? source.end : occ.end,
        isRecurring: true,
        isException,
        originalStart: occ.originalStart.toISOString(),
      });
    }
  }

  return [...nonRecurringItems, ...occurrenceItems].sort(
    (a: any, b: any) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );
}

export const getEvents = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 100));
    const skip = (page - 1) * limit;

    const { start, end, search, calendarId, departmentId, categoryId } = req.query;
    const rangeStart = start ? new Date(start as string) : null;
    const rangeEnd = end ? new Date(end as string) : null;

    // Each condition lives in its own AND-slot rather than sharing one
    // top-level `OR` key — an access-scope OR and a free-text-search OR
    // would otherwise collide on the same `where.OR` property.
    const and: Prisma.CalendarEventWhereInput[] = [];

    if (req.user!.role !== 'Admin') {
      and.push({
        OR: [
          { ownerId: req.user!.id },
          { guests: { some: { userId: req.user!.id } } },
          { visibility: 'public' },
        ],
      });
    }

    if (search) {
      const q = String(search);
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { location: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    if (calendarId) and.push({ calendarId: Number(calendarId) });
    if (departmentId) and.push({ departmentId: Number(departmentId) });
    if (categoryId) and.push({ categoryId: Number(categoryId) });

    // Override rows (an occurrence's edited-instance data — see
    // EventException) are only ever reachable through the occurrence routes,
    // never listed as if they were their own standalone event.
    if (rangeStart && rangeEnd) {
      and.push({
        OR: [
          {
            // Standard interval-overlap check for a plain event — event.start
            // <= rangeEnd AND event.end >= rangeStart — so a multi-day event
            // that started before rangeStart but still overlaps is included.
            AND: [
              { recurrenceId: null },
              { exceptionOverrideFor: null },
              { start: { lte: rangeEnd } },
              { end: { gte: rangeStart } },
            ],
          },
          {
            // A recurring master's own row can sit outside the visible range
            // yet still produce occurrences inside it — only bound by "the
            // series couldn't have started after the range ends" and "the
            // series hadn't already ended (via until) before it starts".
            AND: [
              { recurrenceId: { not: null } },
              { start: { lte: rangeEnd } },
              { recurrence: { OR: [{ until: null }, { until: { gte: rangeStart } }] } },
            ],
          },
        ],
      });
    } else {
      and.push({ exceptionOverrideFor: null });
      if (rangeEnd) and.push({ start: { lte: rangeEnd } });
      if (rangeStart) and.push({ end: { gte: rangeStart } });
    }

    const where: Prisma.CalendarEventWhereInput = {
      organizationId: req.user!.organizationId,
      ...(and.length ? { AND: and } : {}),
    };

    // Pagination (page/limit/skip/take, and the total/totalPages below)
    // describes the raw CalendarEvent rows this query matches — NOT the
    // number of occurrences ultimately returned in `events`. A single
    // recurring master row can expand into many occurrences within
    // [start, end], so `events.length` in the response can exceed `limit`.
    // This is only correct because the calendar grid always requests one
    // bounded visible range per call (see CalendarStateService, limit: 200)
    // rather than paginating through occurrences — don't "fix" this by
    // trying to paginate the expanded array, or total/totalPages stop
    // meaning what callers expect.
    const [events, total] = await Promise.all([
      prisma.calendarEvent.findMany({
        where,
        include: EVENT_LIST_INCLUDE,
        orderBy: { start: 'asc' },
        skip,
        take: limit,
      }),
      prisma.calendarEvent.count({ where }),
    ]);

    const items = await expandEventsToOccurrences(events, rangeStart, rangeEnd);

    res.status(200).json({
      events: items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const createEvent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      title,
      description,
      location,
      start,
      end,
      allDay,
      color,
      departmentId,
      categoryId,
      calendarId,
      meetingLinkUrl,
      meetingLinkTitle,
      visibility,
      busyStatus,
      guests,
      reminders,
      recurrence,
    } = req.body;

    let calendar: { id: number; ownerId: number; organizationId: number | null } | null = null;
    if (calendarId) {
      calendar = await prisma.calendar.findUnique({ where: { id: Number(calendarId) } });
      if (!calendar) return next(new AppError('Calendar not found', 404));
      if (!canAccessCalendar(req.user! as AuthUser, calendar))
        return next(new AppError('You do not have access to this calendar', 403));
    }

    const event = await prisma.$transaction(async (tx) => {
      const resolvedCalendar = calendar ?? (await getOrCreateDefaultCalendar(tx, req.user! as AuthUser));
      const sequenceId = await nextSequenceId(tx, req.user!.organizationId, 'calendarEvent');

      // Created as its own row first (rather than a nested `recurrence: {
      // create }`) because CalendarEvent's other FKs are all set as plain
      // scalars below (ownerId, calendarId, ...) — Prisma's "Unchecked"
      // input style that requires doesn't allow a nested relation-write for
      // `recurrence` in the same `data` object, since recurrenceId is
      // itself a scalar column on CalendarEvent. Assigning the id directly
      // keeps this consistent with every other FK here.
      const recurringRule = recurrence ? await tx.recurringRule.create({ data: recurrenceCreateData(recurrence) }) : null;

      return tx.calendarEvent.create({
        data: {
          title: title.trim(),
          description: description ?? '',
          location: location || null,
          start: new Date(start),
          end: new Date(end),
          allDay: !!allDay,
          color: color || null,
          departmentId: departmentId ? Number(departmentId) : null,
          categoryId: categoryId ? Number(categoryId) : null,
          ownerId: req.user!.id,
          calendarId: resolvedCalendar.id,
          meetingLinkUrl: meetingLinkUrl || null,
          meetingLinkTitle: meetingLinkUrl ? meetingLinkTitle || null : null,
          meetingLinkPlatform: meetingLinkUrl ? detectMeetingPlatform(meetingLinkUrl) : null,
          visibility: visibility ?? 'standard',
          busyStatus: busyStatus ?? 'busy',
          organizationId: req.user!.organizationId,
          createdById: req.user!.id,
          sequenceId,
          recurrenceId: recurringRule?.id ?? null,
          guests: guests?.length ? { create: guestsCreateData(guests) } : undefined,
          reminders: reminders?.length ? { create: remindersCreateData(reminders) } : undefined,
        },
        include: EVENT_INCLUDE,
      });
    });

    res.status(201).json({ message: 'Event created', event });
  } catch (err) {
    next(err);
  }
};

export const getEventById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = await prisma.calendarEvent.findUnique({
      where: { id: Number(req.params.eventId) },
      include: { ...EVENT_INCLUDE, exceptionOverrideFor: true },
    });
    if (!event) return next(new AppError('Event not found', 404));
    // Override rows are only reachable through the occurrence routes — see
    // EventException — never as if they were their own standalone event.
    if (event.exceptionOverrideFor)
      return next(new AppError('This is an occurrence override, not a standalone event — use the occurrence routes', 404));

    if (!canAccessEvent(req.user! as AuthUser, event))
      return next(new AppError('You do not have access to this event', 403));

    res.status(200).json(event);
  } catch (err) {
    next(err);
  }
};

export const updateEvent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = await prisma.calendarEvent.findUnique({
      where: { id: Number(req.params.eventId) },
      include: { guests: { select: { userId: true } }, exceptionOverrideFor: true },
    });
    if (!event) return next(new AppError('Event not found', 404));
    if (event.exceptionOverrideFor)
      return next(new AppError('This is an occurrence override, not a standalone event — use the occurrence routes', 404));

    if (!canAccessEvent(req.user! as AuthUser, event))
      return next(new AppError('You do not have access to this event', 403));
    if (!canEditEvent(req.user! as AuthUser, event))
      return next(new AppError('You do not have permission to update this event', 403));

    const {
      title,
      description,
      location,
      start,
      end,
      allDay,
      color,
      departmentId,
      categoryId,
      calendarId,
      meetingLinkUrl,
      meetingLinkTitle,
      visibility,
      busyStatus,
      guests,
      reminders,
      recurrence,
    } = req.body;

    if (calendarId !== undefined) {
      const calendar = await prisma.calendar.findUnique({ where: { id: Number(calendarId) } });
      if (!calendar) return next(new AppError('Calendar not found', 404));
      if (!canAccessCalendar(req.user! as AuthUser, calendar))
        return next(new AppError('You do not have access to this calendar', 403));
    }

    const data: Prisma.CalendarEventUncheckedUpdateInput = { updatedById: req.user!.id };
    if (title !== undefined) data.title = title.trim();
    if (description !== undefined) data.description = description;
    if (location !== undefined) data.location = location || null;
    if (start !== undefined) data.start = new Date(start);
    if (end !== undefined) data.end = new Date(end);
    if (allDay !== undefined) data.allDay = !!allDay;
    if (color !== undefined) data.color = color || null;
    if (departmentId !== undefined) data.departmentId = departmentId ? Number(departmentId) : null;
    if (categoryId !== undefined) data.categoryId = categoryId ? Number(categoryId) : null;
    if (calendarId !== undefined) data.calendarId = Number(calendarId);
    if (visibility !== undefined) data.visibility = visibility;
    if (busyStatus !== undefined) data.busyStatus = busyStatus;

    if (meetingLinkUrl !== undefined) {
      if (meetingLinkUrl) {
        data.meetingLinkUrl = meetingLinkUrl;
        data.meetingLinkTitle = meetingLinkTitle || null;
        data.meetingLinkPlatform = detectMeetingPlatform(meetingLinkUrl);
      } else {
        data.meetingLinkUrl = null;
        data.meetingLinkTitle = null;
        data.meetingLinkPlatform = null;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Full-replace, not a diff/merge — matches Project's `tags: { set: [...] }`
      // convention for "the client sends the whole desired list back".
      if (guests !== undefined) {
        await tx.guest.deleteMany({ where: { eventId: event.id } });
        if (guests.length) {
          await tx.guest.createMany({
            data: guestsCreateData(guests).map((g: ReturnType<typeof guestsCreateData>[number]) => ({
              ...g,
              eventId: event.id,
            })),
          });
        }
      }

      if (reminders !== undefined) {
        await tx.eventReminder.deleteMany({ where: { eventId: event.id } });
        if (reminders.length) {
          await tx.eventReminder.createMany({
            data: remindersCreateData(reminders).map((r: ReturnType<typeof remindersCreateData>[number]) => ({
              ...r,
              eventId: event.id,
            })),
          });
        }
      }

      // Same "set the scalar FK directly" reasoning as createEvent's
      // recurringRule handling — `data` here is the Unchecked update input,
      // which has `recurrenceId` but not a `recurrence` relation-write.
      if (recurrence !== undefined) {
        if (recurrence === null) {
          if (event.recurrenceId) {
            // Turning a recurring event back into a plain one: any
            // per-occurrence overrides are real CalendarEvent rows of their
            // own (see EventException) — deleting the RecurringRule alone
            // would leave them dangling, so clean them up first.
            const modifiedExceptions = await tx.eventException.findMany({
              where: { eventId: event.id, action: 'modified', overrideEventId: { not: null } },
              include: { overrideEvent: { include: { attachments: true } } },
            });
            for (const ex of modifiedExceptions) {
              if (!ex.overrideEvent) continue;
              await Promise.allSettled(ex.overrideEvent.attachments.map((a) => destroyBlob(a)));
              await tx.calendarEvent.delete({ where: { id: ex.overrideEvent.id } });
            }
            // Cascades away any remaining skip-only exceptions (no override
            // row of their own, so the loop above never touched them).
            await tx.eventException.deleteMany({ where: { eventId: event.id } });
            // The FK is ON DELETE SET NULL (nullable, no override — see
            // schema), so deleting the rule clears CalendarEvent.recurrenceId
            // at the DB level without this update needing to mention it.
            await tx.recurringRule.delete({ where: { id: event.recurrenceId } });
          }
        } else if (event.recurrenceId) {
          await tx.recurringRule.update({ where: { id: event.recurrenceId }, data: recurrenceCreateData(recurrence) });
        } else {
          const newRule = await tx.recurringRule.create({ data: recurrenceCreateData(recurrence) });
          data.recurrenceId = newRule.id;
        }
      }

      return tx.calendarEvent.update({
        where: { id: event.id },
        data,
        include: EVENT_INCLUDE,
      });
    });

    res.status(200).json({ message: 'Event updated', event: updated });
  } catch (err) {
    next(err);
  }
};

export const deleteEvent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = await prisma.calendarEvent.findUnique({
      where: { id: Number(req.params.eventId) },
      include: { guests: { select: { userId: true } }, attachments: true, exceptionOverrideFor: true },
    });
    if (!event) return next(new AppError('Event not found', 404));
    if (event.exceptionOverrideFor)
      return next(new AppError('This is an occurrence override, not a standalone event — use the occurrence routes', 404));

    if (!canAccessEvent(req.user! as AuthUser, event))
      return next(new AppError('You do not have access to this event', 403));
    if (!canEditEvent(req.user! as AuthUser, event))
      return next(new AppError('You do not have permission to delete this event', 403));

    // Any per-occurrence overrides are real CalendarEvent rows of their own
    // (see EventException) — deleting the master alone would leave them
    // orphaned (their exception row cascades away, but the override row
    // itself wouldn't), so they and their attachment blobs are cleaned up
    // first, same as the master's own attachments below.
    const modifiedExceptions = await prisma.eventException.findMany({
      where: { eventId: event.id, action: 'modified', overrideEventId: { not: null } },
      include: { overrideEvent: { include: { attachments: true } } },
    });

    // No upload endpoint exists for event attachments yet, so these lists
    // should normally be empty — cleaning up any blobs here anyway keeps
    // this consistent with deleteProject's same pre-delete cleanup step,
    // since the DB row cascade (see schema) won't touch Cloudinary/S3.
    await Promise.allSettled(event.attachments.map((a) => destroyBlob(a)));
    for (const ex of modifiedExceptions) {
      if (!ex.overrideEvent) continue;
      await Promise.allSettled(ex.overrideEvent.attachments.map((a) => destroyBlob(a)));
    }

    await prisma.$transaction([
      ...modifiedExceptions
        .filter((ex): ex is typeof ex & { overrideEventId: number } => ex.overrideEventId !== null)
        .map((ex) => prisma.calendarEvent.delete({ where: { id: ex.overrideEventId } })),
      prisma.calendarEvent.delete({ where: { id: event.id } }),
    ]);

    res.status(200).json({ message: 'Event deleted' });
  } catch (err) {
    next(err);
  }
};

// Shared load+guard for all three occurrence-scoped endpoints below: fetches
// the recurring master, rejects override rows (see EventException) hit
// through these routes by mistake, and rejects a valid-but-non-recurring
// event. Returns null (having already called next()) when the request should
// stop here.
async function loadRecurringMasterForOccurrence(
  eventId: number,
  next: NextFunction,
  include: Record<string, unknown>
) {
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    include: { ...include, exceptionOverrideFor: true },
  });
  if (!event) {
    next(new AppError('Event not found', 404));
    return null;
  }
  if ((event as any).exceptionOverrideFor) {
    next(new AppError('This is an occurrence override, not a standalone event — use the occurrence routes', 404));
    return null;
  }
  if (!(event as any).recurrence) {
    next(new AppError('This event does not recur', 400));
    return null;
  }
  return event;
}

export const getOccurrence = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = await loadRecurringMasterForOccurrence(Number(req.params.eventId), next, EVENT_INCLUDE);
    if (!event) return;

    if (!canAccessEvent(req.user! as AuthUser, event as any))
      return next(new AppError('You do not have access to this event', 403));

    const originalStart = new Date(String(req.params.originalStart));
    const recurrence = (event as any).recurrence;
    if (!isGeneratedOccurrence(recurrence, event.start, event.end, originalStart))
      return next(new AppError('This is not a valid occurrence of this event', 404));

    const exception = await prisma.eventException.findUnique({
      where: { eventId_originalStart: { eventId: event.id, originalStart } },
      include: { overrideEvent: { include: EVENT_INCLUDE } },
    });
    if (exception?.action === 'skip') return next(new AppError('This occurrence has been removed', 404));

    const source = exception?.action === 'modified' && exception.overrideEvent ? exception.overrideEvent : event;

    res.status(200).json({
      ...source,
      id: event.id,
      sequenceId: event.sequenceId,
      recurrence,
      isRecurring: true,
      isException: !!exception,
      originalStart: originalStart.toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

export const updateOccurrence = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = await loadRecurringMasterForOccurrence(Number(req.params.eventId), next, {
      guests: { select: { userId: true } },
      recurrence: true,
    });
    if (!event) return;

    if (!canAccessEvent(req.user! as AuthUser, event as any))
      return next(new AppError('You do not have access to this event', 403));
    if (!canEditEvent(req.user! as AuthUser, event))
      return next(new AppError('You do not have permission to update this event', 403));

    const originalStart = new Date(String(req.params.originalStart));
    const recurrence = (event as any).recurrence;
    if (!isGeneratedOccurrence(recurrence, event.start, event.end, originalStart))
      return next(new AppError('This is not a valid occurrence of this event', 404));

    const {
      title,
      description,
      location,
      start,
      end,
      allDay,
      color,
      departmentId,
      categoryId,
      meetingLinkUrl,
      meetingLinkTitle,
      visibility,
      busyStatus,
      guests,
      reminders,
    } = req.body;

    const existing = await prisma.eventException.findUnique({
      where: { eventId_originalStart: { eventId: event.id, originalStart } },
    });
    const duration = event.end.getTime() - event.start.getTime();

    const updated = await prisma.$transaction(async (tx) => {
      const overrideData: Prisma.CalendarEventUncheckedCreateInput = {
        title: title !== undefined ? String(title).trim() : event.title,
        description: description !== undefined ? description : event.description,
        location: location !== undefined ? location || null : event.location,
        start: start !== undefined ? new Date(start) : originalStart,
        end: end !== undefined ? new Date(end) : new Date(originalStart.getTime() + duration),
        allDay: allDay !== undefined ? !!allDay : event.allDay,
        color: color !== undefined ? color || null : event.color,
        departmentId: departmentId !== undefined ? (departmentId ? Number(departmentId) : null) : event.departmentId,
        categoryId: categoryId !== undefined ? (categoryId ? Number(categoryId) : null) : event.categoryId,
        ownerId: event.ownerId,
        calendarId: event.calendarId,
        meetingLinkUrl: meetingLinkUrl !== undefined ? meetingLinkUrl || null : event.meetingLinkUrl,
        meetingLinkTitle:
          meetingLinkUrl !== undefined ? (meetingLinkUrl ? meetingLinkTitle || null : null) : event.meetingLinkTitle,
        meetingLinkPlatform:
          meetingLinkUrl !== undefined
            ? meetingLinkUrl
              ? detectMeetingPlatform(meetingLinkUrl)
              : null
            : event.meetingLinkPlatform,
        visibility: visibility ?? event.visibility,
        busyStatus: busyStatus ?? event.busyStatus,
        organizationId: event.organizationId,
        createdById: event.createdById,
        updatedById: req.user!.id,
        recurrenceId: null,
        sequenceId: null,
      };

      let overrideEventId = existing?.overrideEventId ?? null;
      if (overrideEventId) {
        await tx.calendarEvent.update({ where: { id: overrideEventId }, data: overrideData });
      } else {
        const created = await tx.calendarEvent.create({ data: overrideData });
        overrideEventId = created.id;
      }

      // Full-replace, same convention as updateEvent's guests/reminders.
      if (guests !== undefined) {
        await tx.guest.deleteMany({ where: { eventId: overrideEventId } });
        if (guests.length) {
          await tx.guest.createMany({
            data: guestsCreateData(guests).map((g) => ({ ...g, eventId: overrideEventId as number })),
          });
        }
      }
      if (reminders !== undefined) {
        await tx.eventReminder.deleteMany({ where: { eventId: overrideEventId } });
        if (reminders.length) {
          await tx.eventReminder.createMany({
            data: remindersCreateData(reminders).map((r) => ({ ...r, eventId: overrideEventId as number })),
          });
        }
      }

      await tx.eventException.upsert({
        where: { eventId_originalStart: { eventId: event.id, originalStart } },
        create: { eventId: event.id, originalStart, action: 'modified', overrideEventId },
        update: { action: 'modified', overrideEventId },
      });

      return tx.calendarEvent.findUnique({ where: { id: overrideEventId as number }, include: EVENT_INCLUDE });
    });

    res.status(200).json({
      message: 'Occurrence updated',
      event: {
        ...updated,
        id: event.id,
        sequenceId: event.sequenceId,
        recurrence,
        isRecurring: true,
        isException: true,
        originalStart: originalStart.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
};

export const skipOccurrence = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = await loadRecurringMasterForOccurrence(Number(req.params.eventId), next, {
      guests: { select: { userId: true } },
      recurrence: true,
    });
    if (!event) return;

    if (!canAccessEvent(req.user! as AuthUser, event as any))
      return next(new AppError('You do not have access to this event', 403));
    if (!canEditEvent(req.user! as AuthUser, event))
      return next(new AppError('You do not have permission to update this event', 403));

    const originalStart = new Date(String(req.params.originalStart));
    const recurrence = (event as any).recurrence;
    if (!isGeneratedOccurrence(recurrence, event.start, event.end, originalStart))
      return next(new AppError('This is not a valid occurrence of this event', 404));

    const existing = await prisma.eventException.findUnique({
      where: { eventId_originalStart: { eventId: event.id, originalStart } },
    });

    // destroyBlob hits Cloudinary/S3 over the network, so it runs before the
    // transaction rather than inside it (same reasoning as deleteEvent).
    if (existing?.overrideEventId) {
      const overrideEvent = await prisma.calendarEvent.findUnique({
        where: { id: existing.overrideEventId },
        include: { attachments: true },
      });
      if (overrideEvent) await Promise.allSettled(overrideEvent.attachments.map((a) => destroyBlob(a)));
    }

    await prisma.$transaction(async (tx) => {
      if (existing?.overrideEventId) {
        // Switching modified -> skip: the override row cascades away its
        // own exception row, which the upsert below immediately recreates.
        await tx.calendarEvent.delete({ where: { id: existing.overrideEventId } });
      }
      await tx.eventException.upsert({
        where: { eventId_originalStart: { eventId: event.id, originalStart } },
        create: { eventId: event.id, originalStart, action: 'skip' },
        update: { action: 'skip', overrideEventId: null },
      });
    });

    res.status(200).json({ message: 'Occurrence skipped' });
  } catch (err) {
    next(err);
  }
};
