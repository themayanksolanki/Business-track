import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Attachment, AttachmentsAdapter, DownloadInfo } from '../../models/attachment.model';

@Injectable({ providedIn: 'root' })
export class AttachmentService {
  private readonly api = `${environment.apiUrl}/tasks`;

  constructor(private http: HttpClient) {}

  getAttachments(taskId: number) {
    return this.http.get<Attachment[]>(`${this.api}/${taskId}/attachments`);
  }

  // reportProgress/observe:'events' matches ProjectService's/EventService's
  // upload methods, so the shared <app-attachments> component's progress bar
  // works uniformly across every entity.
  uploadAttachment(taskId: number, file: File): Observable<HttpEvent<{ message: string; attachment: Attachment }>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ message: string; attachment: Attachment }>(
      `${this.api}/${taskId}/attachments`,
      formData,
      { reportProgress: true, observe: 'events' }
    );
  }

  // /download hands back a viewUrl (inline disposition) and downloadUrl
  // (attachment disposition) — a presigned S3 URL, or Cloudinary's
  // already-public one — never the file bytes.
  downloadAttachment(taskId: number, attachmentId: number) {
    return this.http.get<DownloadInfo>(`${this.api}/${taskId}/attachments/${attachmentId}/download`);
  }

  // Starts the 10s server-side countdown; doesn't delete anything itself.
  deleteAttachment(taskId: number, attachmentId: number) {
    return this.http.delete<{ message: string; attachment: Attachment }>(
      `${this.api}/${taskId}/attachments/${attachmentId}`
    );
  }

  undoDeleteAttachment(taskId: number, attachmentId: number) {
    return this.http.post<{ message: string; attachment: Attachment }>(
      `${this.api}/${taskId}/attachments/${attachmentId}/undo`,
      {}
    );
  }

  // Adapter for the shared <app-attachments> component — no addLink, since
  // the task-level backend has no "paste a link" endpoint.
  attachmentsAdapter(taskId: number): AttachmentsAdapter {
    return {
      list: () => this.getAttachments(taskId),
      upload: (file) => this.uploadAttachment(taskId, file),
      download: (a) => this.downloadAttachment(taskId, a.id),
      delete: (a) => this.deleteAttachment(taskId, a.id),
      undoDelete: (a) => this.undoDeleteAttachment(taskId, a.id),
    };
  }
}
