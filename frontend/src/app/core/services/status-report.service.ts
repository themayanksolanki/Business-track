import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { StatusForm } from '../../models/status-form.model';
import { StatusFormSubmission, CreateStatusReportSubmissionPayload } from '../../models/status-form.model';

@Injectable({ providedIn: 'root' })
export class StatusReportService {
  private readonly api = `${environment.apiUrl}/projects`;

  constructor(private http: HttpClient) {}

  getSubmissions(projectId: number | string) {
    return this.http.get<StatusFormSubmission[]>(`${this.api}/${projectId}/status-report/submissions`);
  }

  // null clears the selection back to "No Template Selected".
  selectTemplate(projectId: number | string, statusFormId: number | null) {
    return this.http.patch<{ message: string; activeStatusFormId: number | null; activeStatusForm: StatusForm | null }>(
      `${this.api}/${projectId}/status-report/template`,
      { statusFormId }
    );
  }

  updateRecipients(projectId: number | string, recipients: string[]) {
    return this.http.patch<{ message: string; statusReportRecipients: string[] }>(
      `${this.api}/${projectId}/status-report/recipients`,
      { recipients }
    );
  }

  createSubmission(projectId: number | string, payload: CreateStatusReportSubmissionPayload) {
    return this.http.post<{ message: string; submission: StatusFormSubmission; emailError: string | null }>(
      `${this.api}/${projectId}/status-report/submissions`,
      payload
    );
  }
}
