import type { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { canAccessMetric, canEditMetric } from './metricController.js';

type AuthUser = { id: number; role: string; organizationId: number | null };

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };
const MEMBERSHIP_INCLUDE = { members: { select: { userId: true, role: true } } };

// Same shape as metricController.ts's METRIC_LIST_INCLUDE — kept as its own
// local copy (not exported/shared) since that file doesn't export it either;
// every other list-shaped include in this codebase is defined per-controller.
const SUB_METRIC_INCLUDE = {
  department: { select: { id: true, name: true, color: true } },
  category: { select: { id: true, name: true, color: true } },
  owner: { select: USER_SELECT },
};

// View-only (canAccessMetric, not canEditMetric) — shared with getSubMetrics
// (a read). addSubMetric layers its own canEditMetric check on top, below.
async function loadAccessibleMetric(req: Request, id: number) {
  const metric = await prisma.metric.findUnique({ where: { id }, include: MEMBERSHIP_INCLUDE });
  if (!metric) return { metric: null, error: new AppError('Metric not found', 404) };
  if (!(await canAccessMetric(req.user! as AuthUser, metric)))
    return { metric: null, error: new AppError('You do not have access to this metric', 403) };
  return { metric, error: null };
}

// Returns both directions: `subMetrics` (this metric's own outgoing links —
// addable/removable from here) and `linkedFrom` (other metrics that link to
// this one as their sub-metric — this metric shows up on THEIR Linked tab
// too, per the user's ask that A->B be visible from both A's and B's side).
// `linkedFrom` is still removable from here — DELETE is keyed by
// (metricId, subMetricId) exactly as stored, so unlinking from either side
// just means calling it with the pair in the right order (see
// removeSubMetric below; the frontend calls it with the *other* metric's id
// as :metricId when unlinking an incoming link).
export const getSubMetrics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { metric, error } = await loadAccessibleMetric(req, Number(req.params.metricId));
    if (!metric) return next(error);

    const [outgoing, incoming] = await Promise.all([
      prisma.metricLink.findMany({
        where: { metricId: metric.id },
        include: { subMetric: { include: SUB_METRIC_INCLUDE } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.metricLink.findMany({
        where: { subMetricId: metric.id },
        include: { metric: { include: SUB_METRIC_INCLUDE } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    res.status(200).json({
      subMetrics: outgoing.map((l) => l.subMetric),
      linkedFrom: incoming.map((l) => l.metric),
    });
  } catch (err) {
    next(err);
  }
};

// Builds an adjacency list of every MetricLink edge within `organizationId`
// (cheap in-memory BFS target — an org's total link count is nowhere near
// large enough to need a recursive SQL CTE), then walks outgoing edges from
// `fromNodeId` to see if `targetId` is reachable. Used both directions by
// addSubMetric: adding edge metricId->subMetricId would create a cycle iff
// subMetricId can already reach metricId.
async function wouldCreateCycle(organizationId: number | null, metricId: number, subMetricId: number): Promise<boolean> {
  const edges = await prisma.metricLink.findMany({
    where: { metric: { organizationId } },
    select: { metricId: true, subMetricId: true },
  });

  const adjacency = new Map<number, number[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.metricId);
    if (list) list.push(edge.subMetricId);
    else adjacency.set(edge.metricId, [edge.subMetricId]);
  }

  const visited = new Set<number>();
  const stack = [subMetricId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === metricId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) stack.push(next);
  }
  return false;
}

export const addSubMetric = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metricId = Number(req.params.metricId);
    const { subMetricId: rawSubMetricId } = req.body;
    const subMetricId = Number(rawSubMetricId);

    if (subMetricId === metricId) return next(new AppError('A metric cannot be linked to itself', 400));

    const { metric, error } = await loadAccessibleMetric(req, metricId);
    if (!metric) return next(error);
    if (!canEditMetric(req.user! as AuthUser, metric))
      return next(new AppError('You do not have edit access to this metric', 403));

    const subMetric = await prisma.metric.findUnique({ where: { id: subMetricId }, include: MEMBERSHIP_INCLUDE });
    if (!subMetric) return next(new AppError('Sub-metric not found', 404));
    if (!(await canAccessMetric(req.user! as AuthUser, subMetric)))
      return next(new AppError('You do not have access to the sub-metric', 403));

    const existing = await prisma.metricLink.findUnique({ where: { metricId_subMetricId: { metricId, subMetricId } } });
    if (existing) return next(new AppError('This metric is already linked', 400));

    if (await wouldCreateCycle(metric.organizationId, metricId, subMetricId))
      return next(new AppError('This would create a circular dependency between metrics', 400));

    await prisma.metricLink.create({ data: { metricId, subMetricId, createdById: req.user!.id } });

    res.status(201).json({ message: 'Sub-metric linked' });
  } catch (err) {
    next(err);
  }
};

// Access here is deliberately "either end", not just :metricId — the
// frontend calls this with the ids reversed when unlinking an *incoming*
// link (removeLinkedFrom sends the OTHER metric's id as :metricId and this
// metric's own id as :subMetricId, since the edge is stored as
// metricId->subMetricId exactly). Requiring access to :metricId only would
// wrongly block a user who can access the metric they're actually viewing
// but not the other side of the link (e.g. department access drifted apart
// since the link was created).
export const removeSubMetric = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metricId = Number(req.params.metricId);
    const subMetricId = Number(req.params.subMetricId);
    const user = req.user! as AuthUser;

    const [metric, subMetric] = await Promise.all([
      prisma.metric.findUnique({ where: { id: metricId }, include: MEMBERSHIP_INCLUDE }),
      prisma.metric.findUnique({ where: { id: subMetricId }, include: MEMBERSHIP_INCLUDE }),
    ]);
    if (!metric && !subMetric) return next(new AppError('Metric not found', 404));

    const canAccessEither =
      (!!metric && (await canAccessMetric(user, metric))) || (!!subMetric && (await canAccessMetric(user, subMetric)));
    if (!canAccessEither) return next(new AppError('You do not have access to this link', 403));

    // Unlinking is a write — "either end" access above just confirms they
    // can see the link at all; edit rights on at least one end are also
    // required (a Viewer on both ends can't unlink even though they can see it).
    const canEditEither = (!!metric && canEditMetric(user, metric)) || (!!subMetric && canEditMetric(user, subMetric));
    if (!canEditEither) return next(new AppError('You do not have edit access to this link', 403));

    await prisma.metricLink.deleteMany({ where: { metricId, subMetricId } });

    res.status(200).json({ message: 'Sub-metric unlinked' });
  } catch (err) {
    next(err);
  }
};
