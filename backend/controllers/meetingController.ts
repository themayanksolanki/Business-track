import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { nextSequenceId } from '../utils/sequence.js';
import { generateRoomCode } from '../utils/roomCode.js';
import { signRoomToken } from '../utils/meetingToken.js';
import { type AuthUser } from './eventController.js';

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };

const MEETING_INCLUDE = {
  host: { select: USER_SELECT },
  settings: true,
  participants: { include: { user: { select: USER_SELECT } } },
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

export const canEditMeeting = (user: AuthUser, meeting: { hostId: number }) =>
  user.role === 'Admin' || meeting.hostId === user.id;

export const canEndMeeting = (
  user: AuthUser,
  meeting: { hostId: number },
  participants: { userId: number; role: string }[]
) =>
  canEditMeeting(user, meeting) ||
  participants.some((p) => p.userId === user.id && p.role === 'coHost');

const VALID_CALL_TYPES = ['audio', 'video'];

export const createMeeting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, callType, scheduledStart, scheduledEnd } = req.body;

    if (callType !== undefined && !VALID_CALL_TYPES.includes(callType)) {
      return next(new AppError(`Invalid callType: ${callType}`, 400));
    }

    const user = req.user! as AuthUser;

    // roomCode is @unique — collisions are rare (11 alphanumeric chars) but
    // possible, so retry generation a few times on P2002 rather than failing.
    for (let attempt = 0; attempt < 5; attempt++) {
      const roomCode = generateRoomCode();
      try {
        const meeting = await prisma.$transaction(async (tx) => {
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
              settings: { create: {} },
              participants: { create: { userId: user.id, role: 'host', invited: true } },
            },
            include: MEETING_INCLUDE,
          });
          return created;
        });

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
    const meeting = await prisma.meeting.findUnique({ where: { id: Number(req.params.id) } });
    if (!meeting) return next(new AppError('Meeting not found', 404));
    if (!canEditMeeting(req.user! as AuthUser, meeting))
      return next(new AppError('Only the host can cancel this meeting', 403));
    if (meeting.status !== 'scheduled')
      return next(new AppError('Only a scheduled meeting can be cancelled', 409));

    await prisma.meeting.delete({ where: { id: meeting.id } });
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
