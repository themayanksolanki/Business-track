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

// Client-side mirror of backend/utils/metricPeriods.ts's FREQUENCY_CONFIG —
// kept in sync by hand, same convention metric-tracking-grid.component.ts
// already follows for its own daysInMonth/weeksInYear getters (see its
// comment). Needed by MetricSheetComponent to size the full period range
// it renders (no day-windowing there, unlike the tracking grid/bowling
// view — Handsontable scrolls the whole range natively).
export function periodCount(frequency: MetricFrequency, year: number, month?: number | null): number {
  switch (frequency) {
    case 'daily':
      if (!month) throw new Error('periodCount: month is required for daily frequency');
      return new Date(year, month, 0).getDate();
    case 'weekly':
      return isoWeeksInYear(year);
    case 'monthly':
      return 12;
    case 'quarterly':
      return 4;
    case 'yearly':
      // `year` is the block's anchor/start year, not a single calendar year
      // — period 1 is that year, period 5 is anchor+4 (mirrors the backend).
      return 5;
  }
}

// ISO 8601: a year has 53 weeks iff Jan 1 falls on a Thursday, or it's a
// leap year and Jan 1 falls on a Wednesday — mirrors isoWeeksInYear in
// backend/utils/metricPeriods.ts.
function isoWeeksInYear(year: number): number {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const jan1Day = new Date(year, 0, 1).getDay();
  if (jan1Day === 4) return 53;
  if (jan1Day === 3 && isLeap) return 53;
  return 52;
}

// The same weekly→quarter window boundaries metric-bowling/metric-tracking-
// grid use for Prev/Next paging — promoted here since MetricSheetComponent's
// rollup view needs the same boundaries for actual aggregation (grouping
// weeks into a quarter bucket), not just windowing. Returns 4 inclusive
// [startWeek, endWeek] ranges covering every week of `year`.
const WEEKLY_QUARTER_STARTS = [1, 14, 27, 40];
export function weeklyQuarterRanges(year: number): [number, number][] {
  const total = isoWeeksInYear(year);
  return WEEKLY_QUARTER_STARTS.map((start, i) => [start, i < 3 ? WEEKLY_QUARTER_STARTS[i + 1] - 1 : total] as [number, number]);
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
