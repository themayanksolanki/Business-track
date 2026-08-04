// Shared by every "recent trend" consumer (the metric-form-modal's
// Statistics tab, the Tiles View's flip-to-trend chart) so they all render
// the same trailing window/labels for a given frequency.
import type { MetricFrequency } from '../../models/metric-tracking.model';
import { MONTH_LABELS } from './metric-period.util';

export const TREND_ACTUAL_COLOR = '#3b82f6';
export const TREND_TARGET_COLOR = '#f59e0b';

export function trendPeriodLabel(frequency: MetricFrequency, period: number, year: number): string {
  if (frequency === 'weekly') return `W${period}`;
  if (frequency === 'monthly') return MONTH_LABELS[period - 1];
  if (frequency === 'quarterly') return `Q${period}`;
  if (frequency === 'yearly') return String(year + period - 1);
  return String(period);
}

// The `points`-wide window of period numbers ending at `currentPeriod`
// (never going below 1).
export function trendWindow(currentPeriod: number, points: number): number[] {
  const start = Math.max(1, currentPeriod - points + 1);
  return Array.from({ length: currentPeriod - start + 1 }, (_, i) => start + i);
}

export const FREQUENCY_UNIT_LABEL: Record<MetricFrequency, string> = {
  daily: 'Day', weekly: 'Week', monthly: 'Month', quarterly: 'Quarter', yearly: 'Year',
};
export const FREQUENCY_UNIT_ABBR: Record<MetricFrequency, string> = {
  daily: 'D', weekly: 'W', monthly: 'M', quarterly: 'Q', yearly: 'Y',
};

// Same as trendPeriodLabel but with the year appended (ambiguous otherwise
// across a year boundary in a "Best Month" stat tile); yearly already
// returns an absolute year so it's left alone.
export function trendPeriodFullLabel(frequency: MetricFrequency, period: number, year: number): string {
  const label = trendPeriodLabel(frequency, period, year);
  return frequency === 'yearly' ? label : `${label} ${year}`;
}