// Decimal-formats a raw number per the viewing user's own decimalPoints
// preference, then decorates it with a unit/symbol per the metric's
// dataType — the symbol itself always comes from the metric's organization's
// fixed currency/unit (see Organization.currency/.unit), never the metric or
// viewer. No conversion happens either way, this is a label only. Shared by
// the Bowling View, Tiles View, and the metric-form-modal's gauge summary.
import { MetricDataType } from '../../models/metric.model';
import { Currency, MeasurementUnit, CURRENCY_SYMBOLS, MEASUREMENT_UNIT_SYMBOLS } from '../../models/user.model';

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

// Ratio*100 — null means "no target set for the current period" (callers
// typically render a neutral/empty state for that), 0 covers "target set
// but nothing tracked yet", anything past 100 means the target's exceeded.
export function percentOfTarget(actual: number | null, target: number | null): number | null {
  if (target == null || target <= 0) return null;
  return ((actual ?? 0) / target) * 100;
}
