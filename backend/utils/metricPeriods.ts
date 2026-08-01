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

interface FrequencyConfig {
  requiresMonth: boolean;
  count: (year: number, month?: number | null) => number;
}

// One entry per implemented frequency — validate.ts derives its "is this
// frequency allowed yet" checks from this same config, so adding a new
// frequency (quarterly, yearly, ...) is just one more entry here.
const FREQUENCY_CONFIG: Record<string, FrequencyConfig> = {
  daily: {
    requiresMonth: true,
    count: (year, month) => {
      if (!month) throw new Error('periodCount: month is required for daily frequency');
      // Day 0 of the next month == the last day of `month`.
      return new Date(year, month, 0).getDate();
    },
  },
  weekly: {
    requiresMonth: false,
    count: (year) => isoWeeksInYear(year),
  },
  monthly: {
    requiresMonth: false,
    count: () => 12,
  },
  quarterly: {
    requiresMonth: false,
    count: () => 4,
  },
  // `year` doubles as the block's anchor/start year here (not a single
  // calendar year like the other frequencies) — period 1 is that year,
  // period 5 is anchor+4. Bowling View shows all 5 at once, same as
  // monthly/quarterly show their whole year at once.
  yearly: {
    requiresMonth: false,
    count: () => 5,
  },
};

export const IMPLEMENTED_METRIC_FREQUENCIES = Object.keys(FREQUENCY_CONFIG);

export function frequencyRequiresMonth(frequency: string): boolean {
  return FREQUENCY_CONFIG[frequency]?.requiresMonth ?? false;
}

export function periodCount(frequency: MetricFrequency, year: number, month?: number | null): number {
  const config = FREQUENCY_CONFIG[frequency];
  if (!config) throw new Error(`periodCount: frequency '${frequency}' is not implemented yet`);
  return config.count(year, month);
}
