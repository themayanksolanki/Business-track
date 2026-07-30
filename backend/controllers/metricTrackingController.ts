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
    //
    // Can't use upsert()'s compound-unique shorthand here: Prisma rejects a
    // `null` in a compound-unique lookup outright (SQL `=` never matches
    // NULL), and `month` really is `null` for every non-daily frequency. A
    // plain filter supports `month: null` fine (translates to IS NULL), so
    // find-then-create/update instead; on a create/create race, retry as an
    // update (matches the P2002-retry convention used elsewhere, e.g.
    // projectRoleController.ts).
    const existingTotal = await prisma.metricPeriodTotal.findFirst({
      where: { metricId: metric.id, frequency, year, month },
    });
    if (existingTotal) {
      await prisma.metricPeriodTotal.update({
        where: { id: existingTotal.id },
        data: { actualTotal, targetTotal },
      });
    } else {
      try {
        await prisma.metricPeriodTotal.create({
          data: { metricId: metric.id, frequency, year, month, actualTotal, targetTotal },
        });
      } catch (err: any) {
        if (err.code !== 'P2002') throw err;
        await prisma.metricPeriodTotal.updateMany({
          where: { metricId: metric.id, frequency, year, month },
          data: { actualTotal, targetTotal },
        });
      }
    }

    const obj = doc.toObject({ flattenMaps: true });
    res.status(200).json({ periods: obj.periods, actualTotal: obj.actualTotal, targetTotal: obj.targetTotal });
  } catch (err) {
    next(err);
  }
};
