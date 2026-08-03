import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Metric, MetricStatus, CreateMetricPayload, UpdateMetricPayload, PaginatedMetrics, MetricTileItem, MetricListItem, MetricMember, MetricMemberRole } from '../../models/metric.model';
import { MetricFrequency, MetricTrackingData, TrackingDiff } from '../../models/metric-tracking.model';
import { Attachment, AttachmentsAdapter, DownloadInfo } from '../../models/attachment.model';
import { PaginatedUsers } from '../../models/user.model';

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

  // Unpaginated, drag-drop-ordered feed for the Tiles View.
  getMetricTiles() {
    return this.http.get<MetricTileItem[]>(`${this.api}/tiles`);
  }

  // Reorders one sibling group at a time — `orderedIds` must be exactly the
  // active metrics sharing `parentId` (see backend's reorderMetrics).
  reorderMetrics(parentId: number | null, orderedIds: number[]) {
    return this.http.patch<{ message: string }>(`${this.api}/reorder`, { parentId, orderedIds });
  }

  // Tracking — daily/weekly/monthly/quarterly/yearly Actual+Target numbers,
  // stored in MongoDB (see backend/models/metricTracking.model.ts). Always
  // parameterized by `frequency`. `month` is only meaningful for 'daily' —
  // omit it (or pass null) for every other frequency, whose period key only
  // depends on `year`.
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

  // Linked tab — a many-to-many, directed, cycle-checked graph of
  // sub-metrics (separate from the parentId/children Tiles-grouping tree).
  // `linkedFrom` is the reverse direction: other metrics that link to this
  // one — shown (and removable) on this metric's own Linked tab too.
  getSubMetrics(metricId: number | string) {
    return this.http.get<{ subMetrics: MetricListItem[]; linkedFrom: MetricListItem[] }>(`${this.api}/${metricId}/links`);
  }

  addSubMetric(metricId: number | string, subMetricId: number) {
    return this.http.post<{ message: string }>(`${this.api}/${metricId}/links`, { subMetricId });
  }

  // Unlinks the edge stored as (metricId -> subMetricId) exactly — to remove
  // an incoming ("linked from") link, pass the OTHER metric's id as
  // `metricId` and this metric's own id as `subMetricId`.
  removeSubMetric(metricId: number | string, subMetricId: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${metricId}/links/${subMetricId}`);
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

  // Team tab — Owner/Editor/Viewer membership, mirroring ProjectService's
  // own member methods (see project.service.ts) but keyed by a fixed
  // 3-value role instead of a ProjectRole id.
  getMetricMembers(metricId: number | string) {
    return this.http.get<MetricMember[]>(`${this.api}/${metricId}/members`);
  }

  getMetricMemberCandidates(metricId: number | string, page: number, limit: number, search?: string) {
    const params: Record<string, string | number> = { page, limit };
    if (search) params['search'] = search;
    return this.http.get<PaginatedUsers>(`${this.api}/${metricId}/members/candidates`, { params });
  }

  addMetricMember(metricId: number | string, userId: number, role: MetricMemberRole) {
    return this.http.post<{ message: string; members: MetricMember[] }>(
      `${this.api}/${metricId}/members`,
      { userId, role }
    );
  }

  updateMetricMemberRole(metricId: number | string, memberId: number, role: MetricMemberRole) {
    return this.http.patch<{ message: string; members: MetricMember[] }>(
      `${this.api}/${metricId}/members/${memberId}`,
      { role }
    );
  }

  removeMetricMember(metricId: number | string, memberId: number) {
    return this.http.delete<{ message: string; members: MetricMember[] }>(
      `${this.api}/${metricId}/members/${memberId}`
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
