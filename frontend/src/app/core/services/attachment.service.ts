import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { switchMap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Attachment } from '../../models/attachment.model';

interface DownloadInfo {
  url: string;
  mimeType: string;
  fileName: string;
}

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

  // /download hands back a short-lived URL (presigned S3, or Cloudinary's
  // already-public one) rather than the file bytes — see project.service.ts's
  // fetchFile for why.
  downloadAttachment(taskId: number, attachmentId: number) {
    return this.http
      .get<DownloadInfo>(`${this.api}/${taskId}/attachments/${attachmentId}/download`)
      .pipe(switchMap((info) => this.http.get(info.url, { responseType: 'blob' })));
  }
}
