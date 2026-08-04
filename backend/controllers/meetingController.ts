import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { nextSequenceId } from '../utils/sequence.js';
import { generateRoomCode } from '../utils/roomCode.js';
import { signRoomToken, signGuestSessionToken } from '../utils/meetingToken.js';
import {
  type AuthUser,
  canAccessEvent,
  canEditEvent,
  getOrCreateDefaultCalendar,
} from './eventController.js';
import { canAccessProject } from './projectController.js';
import { canAccessGroup } from './groupController.js';
import { notifyUsers } from '../utils/notifications.js';

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };

const MEETING_INCLUDE = {
  host: { select: USER_SELECT },
  settings: true,
  participants: { include: { user: { select: USER_SELECT } } },
  calendarEvent: { select: { id: true, sequenceId: true, title: true, start: true, end: true } },
  project: { select: { id: true, sequenceId: true, name: true } },
  group: { select: { id: true, sequenceId: true, name: true } },
};

// Mirrors organizationController.ts's buildInviteLink — same CLIENT_URL
// env var, same "first of a comma-joined list" parsing.
const buildMeetingLink = (roomCode: string) => {
  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:4200').split(',')[0].trim();
  return `${clientUrl}/meet/${roomCode}`;
};

interface MeetingForAccess {
  organizationId: number | null;
  hostId: number;
  participants: { userId: number }[];
  settings: { allowGuestJoin: boolean } | null;
}

// Same-org member who is the host, an existing participant, an Admin, or
// (if the host allows it) any other same-org member joining via the shared
// link — mirrors canAccessEvent/canAccessCalendar in eventController.ts.
export const canAccessMeeting = (user: AuthUser, meeting: MeetingForAccess) => {
  if (meeting.organizationId !== user.organizationId) return false;
  if (user.role === 'Admin') return true;
  if (meeting.hostId === user.id) return true;
  if (meeting.participants.some((p) => p.userId === user.id)) return true;
  return meeting.settings?.allowGuestJoin ?? false;
};

interface MeetingForGuestAccess {
  status: string;
  host: { isActive: boolean };
  settings: { allowExternalGuests: boolean } | null;
}

// Unlike canAccessMeeting above, this is for a visitor with NO account at
// all — no organizationId to compare, so the check is purely: is the
// meeting still joinable, has the host allowed it, and is the host still a
// real active member (a deactivated host's meetings shouldn't stay
// guest-joinable just because the settings row still says yes). There's no
// equivalent "is the organization still active" check — organizations have
// no deactivation/soft-delete concept anywhere in this schema, so
// meeting.host's organizationId is always a real, permanent row.
export const canGuestAccessMeeting = (meeting: MeetingForGuestAccess) => {
  if (meeting.status === 'ended' || meeting.status === 'cancelled') return false;
  if (!meeting.host.isActive) return false;
  return meeting.settings?.allowExternalGuests ?? false;
};

// Cross-org check first, same as canAccessMeeting — an Admin/host match on
// role/id alone isn't enough; without this an Admin (or a host id that
// happens to collide numerically) in one org could edit/end another org's
// meeting entirely.
export const canEditMeeting = (user: AuthUser, meeting: { organizationId: number | null; hostId: number }) => {
  if (meeting.organizationId !== user.organizationId) return false;
  return user.role === 'Admin' || meeting.hostId === user.id;
};

export const canEndMeeting = (
  user: AuthUser,
  meeting: { organizationId: number | null; hostId: number },
  participants: { userId: number; role: string }[]
) =>
  canEditMeeting(user, meeting) ||
  participants.some((p) => p.userId === user.id && p.role === 'coHost');

const VALID_CALL_TYPES = ['audio', 'video'];

export const createMeeting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, callType, scheduledStart, scheduledEnd, calendarEventId, projectId, groupId } = req.body;

    if (callType !== undefined && !VALID_CALL_TYPES.includes(callType)) {
      return next(new AppError(`Invalid callType: ${callType}`, 400));
    }

    const user = req.user! as AuthUser;

    let calendarEvent: { id: number; ownerId: number; organizationId: number | null } | null = null;
    if (calendarEventId) {
      const found = await prisma.calendarEvent.findUnique({
        where: { id: Number(calendarEventId) },
        include: { guests: { select: { userId: true } }, meeting: { select: { id: true } } },
      });
      if (!found) return next(new AppError('Calendar event not found', 404));
      if (!canAccessEvent(user, found))
        return next(new AppError('You do not have access to this calendar event', 403));
      if (!canEditEvent(user, found))
        return next(new AppError('You do not have permission to add a meeting to this event', 403));
      if (found.meeting) return next(new AppError('This event already has a Meet Hub room', 409));
      calendarEvent = found;
    }

    let project: { id: number } | null = null;
    if (projectId) {
      const found = await prisma.project.findUnique({
        where: { id: Number(projectId) },
        select: {
          id: true,
          organizationId: true,
          departmentId: true,
          createdById: true,
          ownerId: true,
          members: { select: { userId: true } },
        },
      });
      if (!found) return next(new AppError('Project not found', 404));
      if (!(await canAccessProject(user, found)))
        return next(new AppError('You do not have access to this project', 403));
      project = found;
    }

    // All current members are auto-invited as participants (see below) — a
    // group call is for the group, not an org-wide open link, so it needs
    // the member list up front rather than just an id.
    let group: { id: number; members: { userId: number }[] } | null = null;
    if (groupId) {
      const found = await prisma.group.findUnique({
        where: { id: Number(groupId) },
        include: { members: { select: { userId: true } } },
      });
      if (!found) return next(new AppError('Group not found', 404));
      if (!canAccessGroup(user, found)) return next(new AppError('You do not have access to this group', 403));
      group = found;
    }

    // roomCode is @unique — collisions are rare (11 alphanumeric chars) but
    // possible, so retry generation a few times on P2002 rather than failing.
    for (let attempt = 0; attempt < 5; attempt++) {
      const roomCode = generateRoomCode();
      try {
        const meeting = await prisma.$transaction(async (tx) => {
          let linkedCalendarEventId = calendarEvent?.id ?? null;
          let autoCreatedEvent = false;

          if (calendarEvent) {
            // Existing event supplied — attach this room to it directly.
            await tx.calendarEvent.update({
              where: { id: calendarEvent.id },
              data: { meetingLinkUrl: buildMeetingLink(roomCode), meetingLinkTitle: 'Meet Hub' },
            });
          } else if (scheduledStart) {
            // Standalone scheduled meeting (Meet Hub "New meeting" or a
            // project's "Schedule meeting") with no existing event to attach
            // to — auto-create a bare one so it shows up on the calendar.
            const resolvedCalendar = await getOrCreateDefaultCalendar(tx, user);
            const eventSequenceId = await nextSequenceId(tx, user.organizationId, 'calendarEvent');
            const autoEvent = await tx.calendarEvent.create({
              data: {
                title: title?.trim() || 'Meeting',
                start: new Date(scheduledStart),
                end: scheduledEnd ? new Date(scheduledEnd) : new Date(scheduledStart),
                ownerId: user.id,
                calendarId: resolvedCalendar.id,
                organizationId: user.organizationId,
                createdById: user.id,
                sequenceId: eventSequenceId,
                projectId: project?.id ?? null,
                meetingLinkUrl: buildMeetingLink(roomCode),
                meetingLinkTitle: 'Meet Hub',
              },
            });
            linkedCalendarEventId = autoEvent.id;
            autoCreatedEvent = true;
          }

          const sequenceId = await nextSequenceId(tx, user.organizationId, 'meeting');
          const created = await tx.meeting.create({
            data: {
              roomCode,
              title: title?.trim() || null,
              callType: callType || 'video',
              hostId: user.id,
              organizationId: user.organizationId,
              createdById: user.id,
              sequenceId,
              scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
              scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
              calendarEventId: linkedCalendarEventId,
              calendarEventAutoCreated: autoCreatedEvent,
              projectId: project?.id ?? null,
              groupId: group?.id ?? null,
              // A group meeting is for that group's members only — an
              // org-wide guest-join link would defeat the point of scoping
              // it to the group. Every other creation path keeps the
              // existing default (guests may join via the shared link).
              settings: { create: group ? { allowGuestJoin: false } : {} },
              participants: {
                create: [
                  { userId: user.id, role: 'host', invited: true },
                  ...(group
                    ? group.members
                        .filter((m) => m.userId !== user.id)
                        .map((m) => ({ userId: m.userId, role: 'attendee' as const, invited: true }))
                    : []),
                ],
              },
            },
            include: MEETING_INCLUDE,
          });
          return created;
        });

        // Fire-and-forget, after commit — a group call is instant (no
        // scheduling flow invites anyone else yet), so this is always
        // "starting now", never a future "invited" notice.
        if (group) {
          void notifyUsers(
            group.members.map((m) => m.userId).filter((id) => id !== user.id),
            user.id,
            {
              type: 'meetingStarting',
              title: `${meeting.title || 'Group call'} started`,
              message: `${req.user!.username ?? 'Someone'} started a call in a group you're in.`,
              meetingId: meeting.id,
              groupId: group.id,
            }
          );
        }

        return res.status(201).json({ message: 'Meeting created', meeting });
      } catch (err: any) {
        if (err.code === 'P2002' && attempt < 4) continue;
        throw err;
      }
    }
  } catch (err) {
    next(err);
  }
};

export const getMeetingByRoomCode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { roomCode: req.params.roomCode as string },
      include: MEETING_INCLUDE,
    });
    if (!meeting) return next(new AppError('Meeting not found', 404));
    if (!canAccessMeeting(req.user! as AuthUser, meeting))
      return next(new AppError('You do not have access to this meeting', 403));

    res.status(200).json(meeting);
  } catch (err) {
    next(err);
  }
};

export const joinMeeting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: Number(req.params.id) },
      include: MEETING_INCLUDE,
    });
    if (!meeting) return next(new AppError('Meeting not found', 404));
    if (meeting.status === 'ended' || meeting.status === 'cancelled')
      return next(new AppError('This meeting has ended', 409));
    if (!canAccessMeeting(req.user! as AuthUser, meeting))
      return next(new AppError('You do not have access to this meeting', 403));

    const user = req.user! as AuthUser;

    await prisma.$transaction(async (tx) => {
      await tx.meetingParticipant.upsert({
        where: { meetingId_userId: { meetingId: meeting.id, userId: user.id } },
        create: { meetingId: meeting.id, userId: user.id, invited: false, joinedAt: new Date() },
        update: { joinedAt: new Date(), leftAt: null },
      });
      if (meeting.status === 'scheduled') {
        await tx.meeting.update({
          where: { id: meeting.id },
          data: { status: 'live', startedAt: meeting.startedAt ?? new Date() },
        });
      }
    });

    const roomToken = signRoomToken(meeting.id, user.id);
    res.status(200).json({ message: 'Joined meeting', meeting, roomToken });
  } catch (err) {
    next(err);
  }
};

// ── Unauthenticated (no `protect`) — see meetingRoutes.ts's '/public' router.
// Deliberately returns a minimal shape, never MEETING_INCLUDE's full
// participant list/emails, since the caller here has no account at all.
export const getPublicMeetingInfo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { roomCode: req.params.roomCode as string },
      select: {
        id: true,
        title: true,
        callType: true,
        status: true,
        host: { select: { username: true, isActive: true } },
        settings: { select: { allowExternalGuests: true } },
      },
    });
    if (!meeting) return next(new AppError('Meeting not found', 404));

    res.status(200).json({
      meetingId: meeting.id,
      title: meeting.title,
      hostName: meeting.host.username,
      callType: meeting.callType,
      status: meeting.status,
      allowExternalGuests: canGuestAccessMeeting(meeting),
    });
  } catch (err) {
    next(err);
  }
};

// Unauthenticated join — creates/reuses a MeetingGuest row (no User/
// MeetingParticipant involved at all) and hands back a long-lived guest
// token that doubles as this guest's Socket.IO handshake credential for the
// rest of the call (see meetingToken.ts's signGuestSessionToken).
export const guestJoinMeeting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    if (!displayName) return next(new AppError('Your name is required to join', 400));
    if (displayName.length > 60) return next(new AppError('Name is too long', 400));
    const { guestKey } = req.body as { guestKey?: string };

    const meeting = await prisma.meeting.findUnique({
      where: { roomCode: req.params.roomCode as string },
      select: {
        id: true,
        status: true,
        host: { select: { isActive: true } },
        settings: { select: { allowExternalGuests: true } },
      },
    });
    if (!meeting) return next(new AppError('Meeting not found', 404));
    if (!canGuestAccessMeeting(meeting))
      return next(new AppError('This meeting does not allow guest access', 403));

    // Rejoin (e.g. a page refresh while still in the lobby/call) reuses the
    // same MeetingGuest row via the guestKey the client already holds,
    // rather than spawning a new guest record every time.
    const existing = guestKey
      ? await prisma.meetingGuest.findUnique({
          where: { meetingId_guestKey: { meetingId: meeting.id, guestKey } },
        })
      : null;

    const guest = existing
      ? await prisma.meetingGuest.update({
          where: { id: existing.id },
          data: { displayName, joinedAt: new Date(), leftAt: null },
        })
      : await prisma.meetingGuest.create({
          data: { meetingId: meeting.id, guestKey: crypto.randomUUID(), displayName },
        });

    if (meeting.status === 'scheduled') {
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { status: 'live', startedAt: new Date() },
      });
    }

    const guestToken = signGuestSessionToken(meeting.id, guest.id, guest.displayName);
    res.status(200).json({
      message: 'Joined as guest',
      meetingId: meeting.id,
      guestId: guest.id,
      guestKey: guest.guestKey,
      displayName: guest.displayName,
      guestToken,
    });
  } catch (err) {
    next(err);
  }
};

export const leaveMeeting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = Number(req.params.id);
    const user = req.user! as AuthUser;

    const participant = await prisma.meetingParticipant.findUnique({
      where: { meetingId_userId: { meetingId, userId: user.id } },
    });
    if (!participant) return next(new AppError('You are not a participant in this meeting', 404));

    await prisma.meetingParticipant.update({
      where: { id: participant.id },
      data: { leftAt: new Date() },
    });
    res.status(200).json({ message: 'Left meeting' });
  } catch (err) {
    next(err);
  }
};

export const endMeeting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: Number(req.params.id) },
      include: { participants: true },
    });
    if (!meeting) return next(new AppError('Meeting not found', 404));
    if (!canEndMeeting(req.user! as AuthUser, meeting, meeting.participants))
      return next(new AppError('Only the host or a co-host can end this meeting', 403));

    await prisma.$transaction([
      prisma.meeting.update({
        where: { id: meeting.id },
        data: { status: 'ended', endedAt: new Date() },
      }),
      prisma.meetingParticipant.updateMany({
        where: { meetingId: meeting.id, leftAt: null },
        data: { leftAt: new Date() },
      }),
    ]);

    res.status(200).json({ message: 'Meeting ended' });
  } catch (err) {
    next(err);
  }
};

export const updateMeeting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meeting = await prisma.meeting.findUnique({ where: { id: Number(req.params.id) } });
    if (!meeting) return next(new AppError('Meeting not found', 404));
    if (!canEditMeeting(req.user! as AuthUser, meeting))
      return next(new AppError('Only the host can update this meeting', 403));

    const { title, scheduledStart, scheduledEnd, settings } = req.body;
    const data: Prisma.MeetingUncheckedUpdateInput = { updatedById: req.user!.id };

    if (title !== undefined) data.title = title?.trim() || null;
    if (scheduledStart !== undefined) data.scheduledStart = scheduledStart ? new Date(scheduledStart) : null;
    if (scheduledEnd !== undefined) data.scheduledEnd = scheduledEnd ? new Date(scheduledEnd) : null;

    const updated = await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        ...data,
        ...(settings
          ? {
              settings: {
                update: {
                  waitingRoomEnabled: settings.waitingRoomEnabled,
                  allowGuestJoin: settings.allowGuestJoin,
                  allowExternalGuests: settings.allowExternalGuests,
                  muteOnEntry: settings.muteOnEntry,
                  recordingEnabled: settings.recordingEnabled,
                },
              },
            }
          : {}),
      },
      include: MEETING_INCLUDE,
    });

    res.status(200).json({ message: 'Meeting updated', meeting: updated });
  } catch (err) {
    next(err);
  }
};

export const cancelMeeting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: Number(req.params.id) },
      include: { participants: { select: { userId: true } } },
    });
    if (!meeting) return next(new AppError('Meeting not found', 404));
    if (!canEditMeeting(req.user! as AuthUser, meeting))
      return next(new AppError('Only the host can cancel this meeting', 403));
    if (meeting.status !== 'scheduled')
      return next(new AppError('Only a scheduled meeting can be cancelled', 409));

    const user = req.user! as AuthUser;

    await prisma.$transaction(async (tx) => {
      await tx.meeting.delete({ where: { id: meeting.id } });
      // Only the bare event this meeting created for itself — an event that
      // already existed before the meeting was attached to it (calendarEventId
      // supplied at create time) survives cancellation untouched. And even
      // among auto-created events, only delete it if it's still bare: a user
      // may have since added a description/guests/attachments to it, in which
      // case it's become its own thing and cancelling the meeting shouldn't
      // take that data down with it.
      if (meeting.calendarEventAutoCreated && meeting.calendarEventId) {
        const [guestCount, attachmentCount] = await Promise.all([
          tx.guest.count({ where: { eventId: meeting.calendarEventId } }),
          tx.attachment.count({ where: { calendarEventId: meeting.calendarEventId } }),
        ]);
        const event = await tx.calendarEvent.findUnique({
          where: { id: meeting.calendarEventId },
          select: { description: true },
        });
        const stillBare = !event?.description && guestCount === 0 && attachmentCount === 0;
        if (stillBare) {
          await tx.calendarEvent.delete({ where: { id: meeting.calendarEventId } });
        }
      }
    });

    // Notified only after the delete commits — otherwise a transaction
    // failure would leave users told a meeting was cancelled while it's
    // actually still live/joinable in the DB. meetingId is still valid at
    // insert time here, then gets SetNull'd once the meeting row is gone
    // (see notification.prisma), which is exactly right: a cancelled meeting
    // shouldn't leave a working "Join" link behind.
    await notifyUsers(
      meeting.participants.map((p) => p.userId).filter((id) => id !== user.id),
      user.id,
      {
        type: 'meetingCancelled',
        title: `${meeting.title || 'Meeting'} cancelled`,
        message: `${req.user!.username ?? 'The host'} cancelled this meeting.`,
        meetingId: meeting.id,
        ...(meeting.groupId ? { groupId: meeting.groupId } : {}),
      }
    );

    res.status(200).json({ message: 'Meeting cancelled' });
  } catch (err) {
    next(err);
  }
};

export const getUpcomingMeetings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user! as AuthUser;

    const meetings = await prisma.meeting.findMany({
      where: {
        status: 'scheduled',
        scheduledStart: { gte: new Date() },
        OR: [{ hostId: user.id }, { participants: { some: { userId: user.id } } }],
      },
      include: MEETING_INCLUDE,
      orderBy: { scheduledStart: 'asc' },
    });

    res.status(200).json(meetings);
  } catch (err) {
    next(err);
  }
};

// Backs the "Upcoming/past meetings" panel on project-detail — mirrors
// projectMemberController.getMembers's shape (fetch project, check access,
// return a flat array).
export const getProjectMeetings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      select: {
        id: true,
        organizationId: true,
        departmentId: true,
        createdById: true,
        ownerId: true,
        members: { select: { userId: true } },
      },
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user! as AuthUser, project)))
      return next(new AppError('You do not have access to this project', 403));

    const meetings = await prisma.meeting.findMany({
      where: { projectId: project.id },
      include: MEETING_INCLUDE,
      orderBy: { scheduledStart: 'desc' },
    });

    res.status(200).json(meetings);
  } catch (err) {
    next(err);
  }
};

export const getMeetingHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: Number(req.params.id) },
      include: MEETING_INCLUDE,
    });
    if (!meeting) return next(new AppError('Meeting not found', 404));
    if (!canAccessMeeting(req.user! as AuthUser, meeting))
      return next(new AppError('You do not have access to this meeting', 403));

    const participants = meeting.participants.map((p) => ({
      ...p,
      durationSeconds:
        p.joinedAt && p.leftAt ? Math.round((p.leftAt.getTime() - p.joinedAt.getTime()) / 1000) : null,
    }));

    res.status(200).json({ meetingId: meeting.id, participants });
  } catch (err) {
    next(err);
  }
};
