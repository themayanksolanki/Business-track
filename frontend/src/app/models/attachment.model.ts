import { HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User } from './user.model';

// Kept in sync with backend/middleware/attachmentUpload.js's ALLOWED_MIME_TYPES.
export const ACCEPTED_ATTACHMENT_TYPES =
  'image/*,video/mp4,video/webm,video/quicktime,video/x-matroska,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,.zip';

export type AttachmentKind = 'file' | 'link';

export interface Attachment {
  id: number;
  task?: number | null;
  projectItem?: number | null;
  project?: number | null;
  fileName: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedBy: User;
  createdAt: string;
  // 'link' rows have no blob — url is a pasted external link, size is 0, and
  // mimeType is guessed from the URL's extension (falls back to text/html).
  kind?: AttachmentKind;
  // Set while a delete countdown is running; null/undefined once it's undone
  // or hasn't been requested. Source of truth is the server clock, not a
  // client-started timer, so it survives refresh/other tabs.
  pendingDeleteAt?: string | null;
}

// Returned by the various /download endpoints — viewUrl carries an inline
// Content-Disposition (for direct <img>/<video>/<iframe> src), downloadUrl
// carries attachment (for a forced Save As via window.open).
export interface DownloadInfo {
  viewUrl: string;
  downloadUrl: string;
  mimeType: string;
  fileName: string;
}

// Drives the shared <app-attachments> component (shared/attachments) — one
// small object of bound service calls per entity type (task/project/item/
// event/metric), so the component itself never needs to know which backend
// endpoints it's talking to. `undoDelete`/`addLink` are optional because not
// every entity's backend supports them (project-level attachments are
// immediate-delete only, task-level has no "add link" endpoint) — their
// presence/absence is what the component uses to decide which UI to show.
export interface AttachmentsAdapter {
  list(): Observable<Attachment[]>;
  upload(file: File): Observable<HttpEvent<{ message: string; attachment: Attachment }>>;
  download(attachment: Attachment): Observable<DownloadInfo>;
  // Soft-delete backends resolve with the updated (now-pending) row; the
  // immediate-delete (project-level) backend resolves with just a message.
  delete(attachment: Attachment): Observable<{ message: string; attachment?: Attachment }>;
  undoDelete?(attachment: Attachment): Observable<{ message: string; attachment: Attachment }>;
  addLink?(payload: { url: string; fileName?: string }): Observable<{ message: string; attachment: Attachment }>;
}
