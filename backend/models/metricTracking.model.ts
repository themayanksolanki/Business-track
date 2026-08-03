import mongoose from 'mongoose';

// First real Mongoose-backed feature in this app — mongoose.connect() in
// index.ts establishes the default connection at startup; this just defines
// a model against it, the same way the one-off backend/scripts/
// migrateTaskStatus.ts script did.

export type MetricFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export const METRIC_FREQUENCIES: MetricFrequency[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

export type MetricRagStatus = 'Red' | 'Yellow' | 'Green';
export const METRIC_RAG_STATUSES: MetricRagStatus[] = ['Red', 'Yellow', 'Green'];

// 'daily', 'weekly', 'monthly', 'quarterly', and 'yearly' are all implemented
// (see utils/metricPeriods.ts). lowest/medium/upper/status/note back the
// Bowling "Sheet" tab's richer per-period columns — added alongside the
// original actual/target pair, not replacing them. This is a strict
// Mongoose subschema, so any field not declared here is silently dropped on
// save; keep this in sync with validateTrackingDiff (backend/middleware/
// validate.ts) and the frontend's PeriodValue (metric-tracking.model.ts).
const periodValueSchema = new mongoose.Schema(
  {
    actual: { type: Number, default: null },
    target: { type: Number, default: null },
    lowest: { type: Number, default: null },
    medium: { type: Number, default: null },
    upper: { type: Number, default: null },
    status: { type: String, enum: METRIC_RAG_STATUSES, default: null },
    note: { type: String, default: '' },
  },
  { _id: false }
);

const metricTrackingSchema = new mongoose.Schema(
  {
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
  },
  { timestamps: true }
);

metricTrackingSchema.index({ metricId: 1, frequency: 1, year: 1, month: 1 }, { unique: true });

export const MetricTracking = mongoose.model('MetricTracking', metricTrackingSchema, 'metric_tracking');
