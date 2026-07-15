import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Attachment } from '../../models/attachment.model';

@Injectable({ providedIn: 'root' })
export class AttachmentService {
  private readonly api = `${environment.apiUrl}/tasks`;

  constructor(private http: HttpClient) {}

  getAttachments(taskId: string) {
    return this.http.get<Attachment[]>(`${this.api}/${taskId}/attachments`);
  }

  uploadAttachment(taskId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ message: string; attachment: Attachment }>(
      `${this.api}/${taskId}/attachments`,
      formData
    );
  }

  downloadAttachment(taskId: string, attachmentId: string) {
    return this.http.get(`${this.api}/${taskId}/attachments/${attachmentId}/download`, {
      responseType: 'blob',
    });
  }
}
