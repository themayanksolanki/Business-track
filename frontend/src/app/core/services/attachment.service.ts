import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Attachment, DownloadInfo } from '../../models/attachment.model';

@Injectable({ providedIn: 'root' })
export class AttachmentService {
  private readonly api = `${environment.apiUrl}/tasks`;

  constructor(private http: HttpClient) {}

  getAttachments(taskId: number) {
    return this.http.get<Attachment[]>(`${this.api}/${taskId}/attachments`);
  }

  uploadAttachment(taskId: number, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ message: string; attachment: Attachment }>(
      `${this.api}/${taskId}/attachments`,
      formData
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
}
