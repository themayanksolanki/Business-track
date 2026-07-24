import type { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { canAccessMetric } from './metricController.js';
import { MetricTracking } from '../models/metricTracking.model.js';
import type { MetricFrequency } from '../models/metricTracking.model.js';

type AuthUser = { id: number; role: string; organizationId: number | null };

// Shared by both endpoints below — loads the Postgres Metric row (config
// lives there; only the daily/weekly/etc. numbers live in Mongo) and runs
// the same access check the rest of metricController.ts uses. Returns null
// (having already called `next`) on 404/403 so callers can just early-return.
async function loadAccessibleMetric(req: Request, next: NextFunction) {
  const metric = await prisma.metric.findUnique({ where: { id: Number(req.params.metricId) } });
  if (!metric) {
    next(new AppError('Metric not found', 404));
    return null;
  }
  if (!(await canAccessMetric(req.user! as AuthUser, metric))) {
    next(new AppError('You do not have access to this metric', 403));
    return null;
  }
  return metric;
}

export const getPeriodData = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = await loadAccessibleMetric(req, next);
    if (!metric) return;

    const frequency = req.params.frequency as MetricFrequency;
    const year = Number(req.query.year);
    const month = req.query.month !== undefined ? Number(req.query.month) : null;

    const doc = await MetricTracking.findOne({ metricId: metric.id, frequency, year, month });
    if (!doc) {
      res.status(200).json({ periods: {}, actualTotal: 0, targetTotal: 0 });
      return;
    }

    // flattenMaps: the `periods` field is a Mongoose Map — convert it to a
    // plain object for the JSON response instead of leaking Map internals.
    const obj = doc.toObject({ flattenMaps: true });
    res.status(200).json({ periods: obj.periods, actualTotal: obj.actualTotal, targetTotal: obj.targetTotal });
  } catch (err) {
    next(err);
  }
};

export const savePeriodDiff = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = await loadAccessibleMetric(req, next);
    if (!metric) return;

    const frequency = req.params.frequency as MetricFrequency;
    const year = Number(req.query.year);
    const month = req.query.month !== undefined ? Number(req.query.month) : null;
    const diff: Record<string, { actual?: number | null; target?: number | null }> = req.body.diff ?? {};

    // Atomic get-or-create — two requests racing to save the first-ever diff
    // for the same (metricId, frequency, year, month) would otherwise both
    // find nothing, both `new MetricTracking(...)`, and the second `.save()`
    // would throw an uncaught duplicate-key error against the unique index.
    // $setOnInsert only seeds the shell shape (never any day values), so the
    // actual diff-merge and total math below still happen entirely in JS.
    const doc = await MetricTracking.findOneAndUpdate(
      { metricId: metric.id, frequency, year, month },
      { $setOnInsert: { metricId: metric.id, frequency, year, month } },
      { upsert: true, new: true }
    );

    // Merge the diff into the stored periods in application code — never via
    // a Mongo update operator ($set/$inc) — per the requirement that the
    // backend, not Mongo, is responsible for applying updates and computing
    // totals.
    for (const [key, value] of Object.entries(diff)) {
      const existing = doc.periods.get(key);
      const existingObj = existing && typeof (existing as any).toObject === 'function' ? (existing as any).toObject() : existing ?? {};
      doc.periods.set(key, { ...existingObj, ...value });
    }

    let actualTotal = 0;
    let targetTotal = 0;
    for (const value of doc.periods.values()) {
      if (typeof value.actual === 'number') actualTotal += value.actual;
      if (typeof value.target === 'number') targetTotal += value.target;
    }
    doc.actualTotal = actualTotal;
    doc.targetTotal = targetTotal;

    await doc.save();

    // SQL-side mirror of the totals — day-level `periods` detail stays
    // Mongo-only, but the aggregates are also persisted here on every save
    // so Postgres-side reporting/joins (with Department/Category/etc.)
    // don't need to reach into Mongo at all.
    await prisma.metricPeriodTotal.upsert({
      // Prisma's generated compound-unique lookup type doesn't accept `null`
      // for a nullable member column even though the schema allows it — safe
      // to assert non-null here since `month` is only ever a real 1-12 value
      // by the time this runs (only 'daily' frequency reaches this code, and
      // validateTrackingParams already required month to be set for it).
      where: { metricId_frequency_year_month: { metricId: metric.id, frequency, year, month: month as number } },
      create: { metricId: metric.id, frequency, year, month, actualTotal, targetTotal },
      update: { actualTotal, targetTotal },
    });

    const obj = doc.toObject({ flattenMaps: true });
    res.status(200).json({ periods: obj.periods, actualTotal: obj.actualTotal, targetTotal: obj.targetTotal });
  } catch (err) {
    next(err);
  }
};
