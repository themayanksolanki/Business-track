import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { nextSequenceId } from '../utils/sequence.js';
import { canAccessCalendar } from './eventController.js';
// Personal (ownerId-scoped) container a user files events under — unlike
// the org-wide Department/Category taxonomy (role-gated writes), a Calendar
// is only ever managed by its owner (or an Admin), so listing/writes are
// scoped by ownership here rather than by role.
export const getCalendars = async (req, res, next) => {
    try {
        const calendars = await prisma.calendar.findMany({
            where: { ownerId: req.user.id },
            orderBy: { id: 'asc' },
            include: { _count: { select: { events: true } } },
        });
        res.status(200).json(calendars.map(({ _count, ...calendar }) => ({ ...calendar, eventsCount: _count.events })));
    }
    catch (err) {
        next(err);
    }
};
export const createCalendar = async (req, res, next) => {
    try {
        const { name, color } = req.body;
        const trimmedName = name.trim();
        const existing = await prisma.calendar.findFirst({
            where: {
                ownerId: req.user.id,
                name: { equals: trimmedName, mode: 'insensitive' },
            },
        });
        if (existing)
            return next(new AppError('A calendar with this name already exists', 409));
        const calendar = await prisma.$transaction(async (tx) => {
            const sequenceId = await nextSequenceId(tx, req.user.organizationId, 'calendar');
            return tx.calendar.create({
                data: {
                    name: trimmedName,
                    color: color || undefined,
                    ownerId: req.user.id,
                    organizationId: req.user.organizationId,
                    createdById: req.user.id,
                    sequenceId,
                },
            });
        });
        res.status(201).json({ message: 'Calendar created', calendar: { ...calendar, eventsCount: 0 } });
    }
    catch (err) {
        if (err.code === 'P2002')
            return next(new AppError('A calendar with this name already exists', 409));
        next(err);
    }
};
export const updateCalendar = async (req, res, next) => {
    try {
        const calendar = await prisma.calendar.findUnique({ where: { id: Number(req.params.id) } });
        if (!calendar)
            return next(new AppError('Calendar not found', 404));
        if (!canAccessCalendar(req.user, calendar))
            return next(new AppError('You do not have access to this calendar', 403));
        const { name, color, isEnabled } = req.body;
        const data = { updatedById: req.user.id };
        if (name !== undefined) {
            const trimmedName = name.trim();
            const existing = await prisma.calendar.findFirst({
                where: {
                    ownerId: calendar.ownerId,
                    name: { equals: trimmedName, mode: 'insensitive' },
                    id: { not: calendar.id },
                },
            });
            if (existing)
                return next(new AppError('A calendar with this name already exists', 409));
            data.name = trimmedName;
        }
        if (color !== undefined)
            data.color = color;
        if (isEnabled !== undefined)
            data.isEnabled = isEnabled;
        const updated = await prisma.calendar.update({
            where: { id: calendar.id },
            data,
            include: { _count: { select: { events: true } } },
        });
        const { _count, ...rest } = updated;
        res.status(200).json({ message: 'Calendar updated', calendar: { ...rest, eventsCount: _count.events } });
    }
    catch (err) {
        if (err.code === 'P2002')
            return next(new AppError('A calendar with this name already exists', 409));
        next(err);
    }
};
export const deleteCalendar = async (req, res, next) => {
    try {
        const calendar = await prisma.calendar.findUnique({ where: { id: Number(req.params.id) } });
        if (!calendar)
            return next(new AppError('Calendar not found', 404));
        if (!canAccessCalendar(req.user, calendar))
            return next(new AppError('You do not have access to this calendar', 403));
        // CalendarEvent.calendar is ON DELETE CASCADE (see schema) — deleting a
        // Calendar deletes its events with it; the frontend confirm dialog warns
        // using the eventsCount already surfaced by getCalendars.
        await prisma.calendar.delete({ where: { id: calendar.id } });
        res.status(200).json({ message: 'Calendar deleted' });
    }
    catch (err) {
        next(err);
    }
};
//# sourceMappingURL=calendarController.js.map