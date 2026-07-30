import type { MetricFrequency } from '../models/metricTracking.model.js';

// ISO 8601: a year has 53 weeks iff its Jan 1 falls on a Thursday, or it's a
// leap year and Jan 1 falls on a Wednesday (equivalently: iff Dec 31 falls on
// a Thursday, leap or not). Standard "does this year have a week 53" check.
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isoWeeksInYear(year: number): number {
  const jan1Day = new Date(year, 0, 1).getDay(); // 0=Sun..6=Sat
  if (jan1Day === 4) return 53;
  if (jan1Day === 3 && isLeapYear(year)) return 53;
  return 52;
}

// Only 'daily' and 'weekly' are implemented — the monthly/quarterly/yearly
// branches don't exist yet so the storage/API layer (metricTrackingController.ts)
// doesn't need reshaping when they're built, not because they work now. Each
// would need its own period-key scheme (month number, quarter number, or a
// single "period" for a whole year).
export function periodCount(frequency: MetricFrequency, year: number, month?: number | null): number {
  if (frequency === 'daily') {
    if (!month) throw new Error('periodCount: month is required for daily frequency');
    // Day 0 of the next month == the last day of `month`.
    return new Date(year, month, 0).getDate();
  }
  if (frequency === 'weekly') {
    return isoWeeksInYear(year);
  }
  throw new Error(`periodCount: frequency '${frequency}' is not implemented yet`);
}
