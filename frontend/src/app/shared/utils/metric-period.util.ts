// Shared between the Bowling View (paging navigation), the metric-form
// modal's Statistics trend chart, and the Tiles View's gauges — all three
// need to label/locate calendar periods the same way.
import type { MetricFrequency } from '../../models/metric-tracking.model';

export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ISO week-year + week-number of a given date. ISO weeks start Monday and
// week 1 is the week containing the year's first Thursday.
export function isoWeekInfo(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayMon1 = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayMon1); // Thursday of this ISO week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil((((d.getTime() - yearStart) / 86_400_000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export interface CurrentPeriodInfo {
  year: number;
  month: number | null;
  // Which period number (1-indexed, meaning depends on frequency — day-of-
  // month for daily, ISO week for weekly, etc.) corresponds to "now".
  period: number;
}

// Locates "now" on a metric's period axis, for whichever frequency it
// tracks under. `now` is a parameter (rather than read internally) so
// callers rendering many metrics at once can share one `Date` instead of
// each computing a fractionally different "now".
export function currentPeriodInfo(frequency: MetricFrequency, now: Date): CurrentPeriodInfo {
  if (frequency === 'daily') {
    return { year: now.getFullYear(), month: now.getMonth() + 1, period: now.getDate() };
  }
  if (frequency === 'weekly') {
    const info = isoWeekInfo(now);
    return { year: info.year, month: null, period: info.week };
  }
  if (frequency === 'quarterly') {
    return { year: now.getFullYear(), month: null, period: Math.ceil((now.getMonth() + 1) / 3) };
  }
  if (frequency === 'yearly') {
    // No saved block-anchor to read here — default the block to start at
    // the current year and point at its last period (see YEARLY_BLOCK_SIZE
    // in metric-bowling.component.ts) rather than guessing "now" within an
    // arbitrary 5-year block.
    return { year: now.getFullYear(), month: null, period: 5 };
  }
  // monthly
  return { year: now.getFullYear(), month: null, period: now.getMonth() + 1 };
}
