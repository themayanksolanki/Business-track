// Only 'daily' is implemented today — the union already lists the others so
// the service/API calls don't need reshaping when weekly/monthly/quarterly/
// yearly tracking is built later.
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
