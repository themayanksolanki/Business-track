// 'daily', 'weekly', 'monthly', 'quarterly', and 'yearly' are all implemented.
export type MetricFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface PeriodValue {
  actual: number | null;
  target: number | null;
}

// Keyed by period number as a string ("1".."N") — day-of-month for 'daily'.
export type PeriodMap = Record<string, PeriodValue>;

export interface MetricTrackingData {
  periods: PeriodMap;
  actualTotal: number;
  targetTotal: number;
}

export type TrackingDiff = Record<string, Partial<PeriodValue>>;
