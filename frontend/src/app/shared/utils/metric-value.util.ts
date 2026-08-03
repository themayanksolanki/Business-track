// Decimal-formats a raw number per the viewing user's own decimalPoints
// preference, then decorates it with a unit/symbol per the metric's
// dataType — the symbol itself always comes from the metric's organization's
// fixed currency/unit (see Organization.currency/.unit), never the metric or
// viewer. No conversion happens either way, this is a label only. Shared by
// the Bowling View, Tiles View, and the metric-form-modal's gauge summary.
import { MetricDataType, MetricColumnLabels, MetricMembershipLite } from '../../models/metric.model';
import { Currency, MeasurementUnit, CURRENCY_SYMBOLS, MEASUREMENT_UNIT_SYMBOLS } from '../../models/user.model';
import { MetricRagStatus } from '../../models/metric-tracking.model';

// Single source of truth for the Sheet tab's 7 column keys' default display
// names — shared so every place that names these columns (the grid itself,
// the Statistics tab's area chart, anything else added later) agrees with
// a metric's own columnLabels overrides instead of drifting out of sync
// with its own hardcoded copy.
export const DEFAULT_METRIC_COLUMN_LABELS: Record<keyof MetricColumnLabels, string> = {
  actual: 'Actual',
  target: 'Target',
  lowest: 'Lowest',
  medium: 'Medium',
  upper: 'Upper',
  status: 'Status',
  note: 'Notes',
};

export function metricColumnLabel(columnLabels: MetricColumnLabels | null | undefined, key: keyof MetricColumnLabels): string {
  return columnLabels?.[key] || DEFAULT_METRIC_COLUMN_LABELS[key];
}

export function formatMetricValue(
  value: number | null,
  dataType: MetricDataType,
  currency: Currency,
  unit: MeasurementUnit,
  decimalPoints: number
): string {
  if (value == null) return '—';
  const formatted = value.toFixed(decimalPoints);
  switch (dataType) {
    case 'currency':
      return `${CURRENCY_SYMBOLS[currency]}${formatted}`;
    case 'weight':
      return `${formatted} ${MEASUREMENT_UNIT_SYMBOLS[unit]}`;
    case 'percentage':
      return `${formatted}%`;
    default:
      return formatted;
  }
}

// Sheet tab's Status column is always derived, never typed in directly —
// requires all three bands (lowest/medium/upper) plus actual to be present,
// since a status with a missing band would be misleading rather than just
// incomplete. `upper` isn't itself compared against (Green just means
// "above medium"), but its absence still blocks a status the same as a
// missing lowest/medium — that's the spec this mirrors.
export function calculateRagStatus(
  actual: number | null,
  lowest: number | null,
  medium: number | null,
  upper: number | null
): MetricRagStatus | null {
  if (actual === null || lowest === null || medium === null || upper === null) return null;
  if (actual <= lowest) return 'Red';
  if (actual <= medium) return 'Yellow';
  return 'Green';
}

// Ratio*100 — null means "no target set for the current period" (callers
// typically render a neutral/empty state for that), 0 covers "target set
// but nothing tracked yet", anything past 100 means the target's exceeded.
export function percentOfTarget(actual: number | null, target: number | null): number | null {
  if (target == null || target <= 0) return null;
  return ((actual ?? 0) / target) * 100;
}

// Frontend mirror of backend's canEditMetric (metricController.ts), applied
// to a list-page row (Metrics/Tiles/Bowling) instead of a single fetched
// Metric — same "no explicit membership row => unchanged, full-edit access"
// safety net. Used to hide Create/Edit/Delete buttons and gate Bowling's
// inline click-to-edit for a Viewer.
export function canEditMetricListItem(
  user: { id: number; role: string } | null | undefined,
  item: { members?: MetricMembershipLite[] }
): boolean {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  const membership = item.members?.find((m) => m.userId === user.id);
  if (membership) return membership.role !== 'viewer';
  return true;
}
