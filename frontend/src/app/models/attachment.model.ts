import { User } from './user.model';

export interface Attachment {
  _id: string;
  task: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBy: User;
  createdAt: string;
}
