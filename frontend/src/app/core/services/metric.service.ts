import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Metric, MetricStatus, CreateMetricPayload, UpdateMetricPayload, PaginatedMetrics } from '../../models/metric.model';
import { MetricFrequency, MetricTrackingData, TrackingDiff } from '../../models/metric-tracking.model';
import { Attachment, AttachmentsAdapter, DownloadInfo } from '../../models/attachment.model';

@Injectable({ providedIn: 'root' })
export class MetricService {
  private readonly api = `${environment.apiUrl}/metrics`;

  constructor(private http: HttpClient) {}

  getMetrics(page: number, limit: number, status: MetricStatus | 'all' = 'active') {
    return this.http.get<PaginatedMetrics>(this.api, { params: { page, limit, status } });
  }

  getMetricById(metricId: number | string) {
    return this.http.get<Metric>(`${this.api}/${metricId}`);
  }

  createMetric(payload: CreateMetricPayload) {
    return this.http.post<{ message: string; metric: Metric }>(this.api, payload);
  }

  updateMetric(metricId: number | string, payload: UpdateMetricPayload) {
    return this.http.put<{ message: string; metric: Metric }>(`${this.api}/${metricId}`, payload);
  }

  // Tracking — daily/weekly/monthly/quarterly/yearly Actual+Target numbers,
  // stored in MongoDB (see backend/models/metricTracking.model.ts). Always
  // parameterized by `frequency` (only 'daily' and 'weekly' are implemented
  // server-side today) so a future monthly/etc. view reuses these same
  // methods. `month` is only meaningful for 'daily' — omit it (or pass null)
  // for 'weekly', whose period key (ISO week) only depends on `year`.
  getTracking(metricId: number | string, frequency: MetricFrequency, year: number, month?: number | null) {
    const params: Record<string, number> = { year };
    if (month != null) params['month'] = month;
    return this.http.get<MetricTrackingData>(`${this.api}/${metricId}/tracking/${frequency}`, { params });
  }

  saveTrackingDiff(
    metricId: number | string,
    frequency: MetricFrequency,
    year: number,
    month: number | null | undefined,
    diff: TrackingDiff
  ) {
    const params: Record<string, number> = { year };
    if (month != null) params['month'] = month;
    return this.http.put<MetricTrackingData>(
      `${this.api}/${metricId}/tracking/${frequency}`,
      { diff },
      { params }
    );
  }

  // Attachments — file upload or a pasted link, with a 10s undo-able pending
  // delete, mirroring EventService's attachment methods.
  getAttachments(metricId: number | string) {
    return this.http.get<Attachment[]>(`${this.api}/${metricId}/attachments`);
  }

  uploadAttachment(metricId: number | string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ message: string; attachment: Attachment }>(
      `${this.api}/${metricId}/attachments`,
      formData,
      { reportProgress: true, observe: 'events' }
    );
  }

  addLinkAttachment(metricId: number | string, payload: { url: string; fileName?: string }) {
    return this.http.post<{ message: string; attachment: Attachment }>(
      `${this.api}/${metricId}/attachments/link`,
      payload
    );
  }

  downloadAttachment(metricId: number | string, attachmentId: number) {
    return this.http.get<DownloadInfo>(`${this.api}/${metricId}/attachments/${attachmentId}/download`);
  }

  // Starts the 10s server-side countdown; doesn't delete anything itself.
  deleteAttachment(metricId: number | string, attachmentId: number) {
    return this.http.delete<{ message: string; attachment: Attachment }>(
      `${this.api}/${metricId}/attachments/${attachmentId}`
    );
  }

  undoDeleteAttachment(metricId: number | string, attachmentId: number) {
    return this.http.post<{ message: string; attachment: Attachment }>(
      `${this.api}/${metricId}/attachments/${attachmentId}/undo`,
      {}
    );
  }

  // Adapter for the shared <app-attachments> component.
  attachmentsAdapter(metricId: number | string): AttachmentsAdapter {
    return {
      list: () => this.getAttachments(metricId),
      upload: (file) => this.uploadAttachment(metricId, file),
      download: (a) => this.downloadAttachment(metricId, a.id),
      delete: (a) => this.deleteAttachment(metricId, a.id),
      undoDelete: (a) => this.undoDeleteAttachment(metricId, a.id),
      addLink: (payload) => this.addLinkAttachment(metricId, payload),
    };
  }
}
