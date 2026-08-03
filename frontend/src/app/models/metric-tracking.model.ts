// 'daily', 'weekly', 'monthly', 'quarterly', and 'yearly' are all implemented.
export type MetricFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type MetricRagStatus = 'Red' | 'Yellow' | 'Green';
export const METRIC_RAG_STATUSES: MetricRagStatus[] = ['Red', 'Yellow', 'Green'];

export interface PeriodValue {
  actual: number | null;
  target: number | null;
  // Sheet-tab-only fields — kept optional so the older Actual/Target-only
  // metric-tracking-grid can keep constructing/reading PeriodValue without
  // touching these.
  lowest?: number | null;
  medium?: number | null;
  upper?: number | null;
  status?: MetricRagStatus | null;
  note?: string;
}

// Keyed by period number as a string ("1".."N") — day-of-month for 'daily'.
export type PeriodMap = Record<string, PeriodValue>;

export interface MetricTrackingData {
  periods: PeriodMap;
  actualTotal: number;
  targetTotal: number;
}

export type TrackingDiff = Record<string, Partial<PeriodValue>>;
