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

export interface GroupMessage {
  id: number;
  groupId: number;
  sender: User;
  content: string;
  type: MessageType;
  fileUrl?: string | null;
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
