import { User } from './user.model';

export type MessageType = 'text' | 'image' | 'call';
export type CallStatus  = 'completed' | 'missed' | 'rejected';

export interface Message {
  id: number;
  sender: User;
  receiver: User;
  content: string;
  type: MessageType;
  fileUrl?: string | null;
  delivered: boolean;
  read: boolean;
  createdAt: string;
  callType?:     'audio' | 'video';
  callStatus?:   CallStatus;
  callDuration?: number | null;
  isPinned?:  boolean;
  isEdited?:  boolean;
  editedAt?:  string | null;
  isDeleted?: boolean;
  replyTo?: {
    id: number;
    content: string;
    type: MessageType;
    sender: { id?: number; username: string };
  } | null;
}

export interface ContactData {
  user: User;
  lastMessage: Message | null;
  unreadCount: number;
  isBlocked?: boolean;
  blockedByThem?: boolean;
  isMuted?: boolean;
}
