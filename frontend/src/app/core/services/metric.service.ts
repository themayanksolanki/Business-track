import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Metric, MetricStatus, CreateMetricPayload, UpdateMetricPayload, PaginatedMetrics } from '../../models/metric.model';
import { MetricFrequency, MetricTrackingData, TrackingDiff } from '../../models/metric-tracking.model';

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
  // parameterized by `frequency` (only 'daily' is implemented server-side
  // today) so a future weekly/monthly/etc. view reuses these same methods.
  getTracking(metricId: number | string, frequency: MetricFrequency, year: number, month: number) {
    return this.http.get<MetricTrackingData>(`${this.api}/${metricId}/tracking/${frequency}`, {
      params: { year, month },
    });
  }

  saveTrackingDiff(
    metricId: number | string,
    frequency: MetricFrequency,
    year: number,
    month: number,
    diff: TrackingDiff
  ) {
    return this.http.put<MetricTrackingData>(
      `${this.api}/${metricId}/tracking/${frequency}`,
      { diff },
      { params: { year, month } }
    );
  }
}
