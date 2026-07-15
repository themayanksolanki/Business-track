import { User } from './user.model';

export type MessageType = 'text' | 'image' | 'call';
export type CallStatus  = 'completed' | 'missed' | 'rejected';

export interface Message {
  _id: string;
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
    _id: string;
    content: string;
    type: MessageType;
    sender: { _id?: string; username: string };
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
