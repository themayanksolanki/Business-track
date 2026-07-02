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
}

export interface ContactData {
  user: User;
  lastMessage: Message | null;
  unreadCount: number;
}
