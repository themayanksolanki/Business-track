import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Attachment } from '../../models/attachment.model';

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

  downloadAttachment(taskId: number, attachmentId: number) {
    return this.http.get(`${this.api}/${taskId}/attachments/${attachmentId}/download`, {
      responseType: 'blob',
    });
  }
}
