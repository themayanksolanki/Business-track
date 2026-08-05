import type { CallType } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { emitToUser } from '../socket.js';
import { GROUP_MESSAGE_INCLUDE } from '../controllers/groupMessageController.js';

interface GroupForCallEvents {
  id: number;
  name: string;
  members: { userId: number }[];
}

interface MeetingForCallEvents {
  id: number;
  roomCode: string;
  callType: CallType;
}

// Fired right after createMeeting commits a group call — creates the "call
// started" GroupMessage (rendered as a call card, never a pasted link — see
// chat.component.html's group call-event row) and rings every other member
// live, the same way a 1:1 call rings its callee (call:incoming), instead of
// leaving it to a passive chat message someone might not notice.
export const startGroupCallAnnouncement = async (
  meeting: MeetingForCallEvents,
  group: GroupForCallEvents,
  actor: { id: number; username: string }
) => {
  const msg = await prisma.groupMessage.create({
    data: {
      groupId: group.id,
      senderId: actor.id,
      type: 'call',
      callType: meeting.callType,
      meetingId: meeting.id,
      content: '',
    },
    include: GROUP_MESSAGE_INCLUDE,
  });

  emitToUser(actor.id, 'group:message:sent', msg);
  const otherMemberIds = group.members.map((m) => m.userId).filter((id) => id !== actor.id);
  otherMemberIds.forEach((id) => emitToUser(id, 'group:message:receive', msg));

  // The live ring — purely ephemeral (no DB row of its own, unlike the
  // GroupMessage above). A member who's offline right now just sees the
  // call-event bubble (and the meetingStarting Notification) once they're
  // back, plus the still-live "Join Now" group header button.
  otherMemberIds.forEach((id) =>
    emitToUser(id, 'group-call:incoming', {
      groupId: group.id,
      groupName: group.name,
      meetingId: meeting.id,
      roomCode: meeting.roomCode,
      callType: meeting.callType,
      fromUserId: actor.id,
      fromName: actor.username,
    })
  );
};

// Fired once a group call's Meeting row flips to 'ended' via the REST
// endMeeting endpoint (meetingController.ts) — tells every group member, not
// just whoever was still in the mesh room, so the header's "Join Now" button
// disappears and the call-event bubble can settle into its final missed/
// completed state without a refetch. socket.ts's endMeetingRecord (the
// auto-end-when-room-empties path) duplicates this rather than importing it,
// since importing this module there would create a socket.ts <-> here
// import cycle (this module already imports emitToUser from socket.ts).
export const endGroupCallAnnouncement = async (meetingId: number) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      groupId: true,
      endedAt: true,
      participants: { select: { userId: true, joinedAt: true } },
    },
  });
  if (!meeting?.groupId) return;

  const memberIds = await prisma.groupMember.findMany({
    where: { groupId: meeting.groupId },
    select: { userId: true },
  });

  const payload = {
    meetingId,
    groupId: meeting.groupId,
    endedAt: meeting.endedAt,
    participants: meeting.participants,
  };
  memberIds.forEach((m) => emitToUser(m.userId, 'group-call:ended', payload));
};
