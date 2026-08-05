import { User } from './user.model';
import { MessageType } from './message.model';

export type GroupMemberRole = 'admin' | 'member';

export interface GroupMember {
  id: number;
  groupId: number;
  userId: number;
  role: GroupMemberRole;
  joinedAt: string;
  user: User;
}

export interface GroupMessageReplyTo {
  id: number;
  content: string;
  type: MessageType;
  sender: { id?: number; username: string };
}

// Only present on a type: 'call' message — the group-call announcement/log
// bubble. There's no single "missed"/"completed" status here the way a 1:1
// Message has (see message.model.ts's Message.callStatus): a group call's
// outcome differs per member, so the viewing user's own outcome is derived
// from `participants` (find their own userId, missed iff joinedAt is null)
// rather than stored once — see chat.component.ts's groupCallMissed().
export interface GroupMessageMeeting {
  id: number;
  roomCode: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  callType: 'audio' | 'video';
  startedAt: string | null;
  endedAt: string | null;
  hostId: number;
  participants: { userId: number; joinedAt: string | null }[];
}

export interface GroupMessage {
  id: number;
  groupId: number;
  sender: User;
  content: string;
  type: MessageType;
  fileUrl?: string | null;
  callType?: 'audio' | 'video' | null;
  meeting?: GroupMessageMeeting | null;
  isPinned?: boolean;
  isEdited?: boolean;
  editedAt?: string | null;
  isDeleted?: boolean;
  replyTo?: GroupMessageReplyTo | null;
  reads: { userId: number }[];
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: number;
  sequenceId: number | null;
  name: string;
  avatarUrl: string | null;
  organizationId: number | null;
  createdById: number;
  createdAt: string;
  updatedAt: string;
  createdBy: User;
  members: GroupMember[];
}

// GET /api/groups decorates each Group with conversation-list activity —
// mirrors ContactData (message.model.ts) for the chat sidebar's "Groups" tab.
export interface GroupWithActivity extends Group {
  lastMessage: GroupMessage | null;
  unreadCount: number;
}
