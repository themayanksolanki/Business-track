import { User } from './user.model';

// Kept in sync with backend/middleware/attachmentUpload.js's ALLOWED_MIME_TYPES.
export const ACCEPTED_ATTACHMENT_TYPES =
  'image/*,video/mp4,video/webm,video/quicktime,video/x-matroska,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,.zip';

export interface Attachment {
  _id: string;
  task?: string;
  projectItem?: string;
  project?: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBy: User;
  createdAt: string;
}
