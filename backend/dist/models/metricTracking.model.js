import mongoose from 'mongoose';
export const METRIC_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
// Only 'daily' is implemented today (see utils/metricPeriods.ts) — the enum
// already lists the others so the schema/API shape doesn't need reworking
// when they're built later.
const periodValueSchema = new mongoose.Schema({ actual: { type: Number, default: null }, target: { type: Number, default: null } }, { _id: false });
const metricTrackingSchema = new mongoose.Schema({
    // Postgres Metric.id — Mongo is only used for the high-write-frequency
    // daily/weekly/etc. numbers, the metric's own config stays in Postgres.
    metricId: { type: Number, required: true },
    frequency: { type: String, enum: METRIC_FREQUENCIES, required: true },
    year: { type: Number, required: true },
    // Only meaningful for frequency === 'daily' (which month within `year`).
    // Left null for other frequencies until they're implemented.
    month: { type: Number, default: null },
    // Keyed "1".."N" — what N means depends on `frequency` (day-of-month for
    // daily, week-of-year for weekly, etc.).
    periods: { type: Map, of: periodValueSchema, default: {} },
    // Denormalized so reads don't need to walk `periods` — recomputed in
    // application code (metricTrackingController.ts) on every write, never
    // via a Mongo update operator.
    actualTotal: { type: Number, default: 0 },
    targetTotal: { type: Number, default: 0 },
}, { timestamps: true });
metricTrackingSchema.index({ metricId: 1, frequency: 1, year: 1, month: 1 }, { unique: true });
export const MetricTracking = mongoose.model('MetricTracking', metricTrackingSchema, 'metric_tracking');
//# sourceMappingURL=metricTracking.model.js.map