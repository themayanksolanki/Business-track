import { User } from './user.model';

export interface Attachment {
  _id: string;
  task?: string;
  projectItem?: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBy: User;
  createdAt: string;
}
