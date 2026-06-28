import { User } from './user.model';

export type MessageType = 'text' | 'image';

export interface Message {
  _id: string;
  sender: User;
  receiver: User;
  content: string;
  type: MessageType;
  fileUrl?: string | null;
  read: boolean;
  createdAt: string;
}

export interface ContactData {
  user: User;
  lastMessage: Message | null;
  unreadCount: number;
}
