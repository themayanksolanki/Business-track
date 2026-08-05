import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { getAccessibleDepartmentIds, canAccessDepartment } from '../utils/access.js';
import { nextSequenceId } from '../utils/sequence.js';
import { MetricTracking } from '../models/metricTracking.model.js';

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };

// Lightweight — just enough for canAccessMetric's membership bypass and
// canEditMetric's role check. Full user info for the Team tab's own list
// comes from metricMemberController.ts, not this.
const METRIC_MEMBERSHIP_SELECT = { userId: true, role: true };

const METRIC_INCLUDE = {
  department: { select: { id: true, name: true, color: true } },
  category: { select: { id: true, name: true, color: true } },
  owner: { select: USER_SELECT },
  createdBy: { select: USER_SELECT },
  updatedBy: { select: USER_SELECT },
  parent: { select: { id: true, title: true } },
  members: { select: { ...METRIC_MEMBERSHIP_SELECT, id: true, user: { select: USER_SELECT }, addedAt: true } },
};

// Lightweight include for the list view — only what the Metrics page table
// actually renders (name, department, category, owner), mirroring how
// projectController keeps a reduced ACCESS_INCLUDE separate from the full
// PROJECT_INCLUDE. `members` here is the lightweight membership shape only
// (no nested user) — just enough for the list pages' own canEditMetric-style
// button gating, not a member list display.
const METRIC_LIST_INCLUDE = {
  department: { select: { id: true, name: true, color: true } },
  category: { select: { id: true, name: true, color: true } },
  owner: { select: USER_SELECT },
  members: { select: METRIC_MEMBERSHIP_SELECT },
};

type AuthUser = { id: number; role: string; organizationId: number | null };

interface MetricMembershipForAccess {
  userId: number;
  role: string;
}

interface MetricForAccess {
  organizationId: number | null;
  departmentId: number;
  members?: MetricMembershipForAccess[];
}

// Base view-gate — broadened (beyond the original department-only check)
// with a membership bypass: an explicit MetricMember (any role, including
// Viewer) can see the metric even outside their normal department access,
// mirroring canAccessProject's identical member bypass.
export const canAccessMetric = async (user: AuthUser, metric: MetricForAccess) => {
  if (metric.organizationId !== user.organizationId) return false;
  if (user.role === 'Admin') return true;
  if (metric.members?.some((m) => m.userId === user.id)) return true;
  const accessibleIds = await getAccessibleDepartmentIds(user);
  return canAccessDepartment(accessibleIds, metric.departmentId);
};

// Refines "can this user touch this metric" (canAccessMetric having already
// passed) into edit-vs-view — mirrors canEditProject exactly. Department/
// creator/owner-based access stays full-edit, unchanged; only an explicit
// MetricMember whose role is 'viewer' is downgraded to view-only. A metric
// with zero MetricMember rows (every metric before this feature existed)
// behaves identically to before — nobody's edit access changes just because
// this feature shipped.
export const canEditMetric = (user: AuthUser, metric: MetricForAccess) => {
  if (metric.organizationId !== user.organizationId) return false;
  if (user.role === 'Admin') return true;
  const membership = metric.members?.find((m) => m.userId === user.id);
  if (membership) return membership.role !== 'viewer';
  return true;
};

interface MetricForManage {
  createdById: number;
  ownerId: number;
  members?: MetricMembershipForAccess[];
}

// Gates Team-tab administration (add/remove/re-role) specifically — mirrors
// canManageProjectSettings. Narrower than canEditMetric: an Editor can edit
// metric content but cannot manage who's on the team; only an explicit
// 'owner' member, the metric's creator/business-owner, or Admin/Manager can.
export const canManageMetricMembers = (user: AuthUser, metric: MetricForManage) =>
  user.role === 'Admin' ||
  user.role === 'Manager' ||
  metric.createdById === user.id ||
  metric.ownerId === user.id ||
  (metric.members?.some((m) => m.userId === user.id && m.role === 'owner') ?? false);

interface MetricForLock {
  ownerId: number;
}

// Narrower than canManageMetricMembers on purpose — locking freezes every
// field/tracking edit for everyone (including Admins/Managers who aren't
// the owner), so only the metric's own Owner field or an Admin may toggle
// it, not Manager/createdBy/Team-tab 'owner' member.
export const canLockMetric = (user: AuthUser, metric: MetricForLock) =>
  user.role === 'Admin' || metric.ownerId === user.id;

const VALID_METRIC_STATUSES = ['active', 'archived', 'deleted'];

// depths 0-6 => 7 levels total, mirroring ProjectItem's MAX_DEPTH
// (backend/services/statusSync.service.ts) at a slightly deeper cap.
const MAX_METRIC_DEPTH = 6;

export const getMetrics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.MetricWhereInput = { organizationId: req.user!.organizationId };

    if (req.query.status === 'all') {
      // no status filter — every status, including archived/deleted
    } else if (VALID_METRIC_STATUSES.includes(req.query.status as string)) {
      where.status = req.query.status as any;
    } else {
      where.status = 'active';
    }

    // Case-insensitive partial-or-full match on title — same contains +
    // mode: 'insensitive' convention as projectController.ts's own search
    // (and metricMemberController.ts's username/email search). A plain
    // scalar field, deliberately not folded into the where.OR below (that
    // OR is the department/membership ACCESS check — merging search into it
    // would turn "title matches" into another way to bypass access instead
    // of narrowing an already-accessible list).
    const search = (req.query.search as string)?.trim();
    if (search) where.title = { contains: search, mode: 'insensitive' };

    // Department access OR an explicit Team-tab membership — without the
    // OR, a Viewer/Editor/Owner added to a metric outside their own
    // department would never see it in this list at all, even though
    // canAccessMetric itself already says they should (same membership
    // bypass, just expressed as a query filter instead of a per-row check).
    if (req.user!.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user!);
      where.OR = [{ departmentId: { in: accessibleIds ?? [] } }, { members: { some: { userId: req.user!.id } } }];
    }

    const [metrics, total] = await Promise.all([
      prisma.metric.findMany({
        where,
        include: METRIC_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.metric.count({ where }),
    ]);

    res.status(200).json({
      metrics,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

// Bowling View's combined load — used instead of getMetrics + one getTracking
// per row. Scoped to exactly one lens per call (the frequency the frontend
// currently has open, plus a case-insensitive partial-or-full `search` on
// title, same convention as getMetrics) — switching lenses or searching now
// means a fresh call here rather than filtering an already-loaded
// every-frequency batch client-side, so both the Prisma query and the Mongo
// query only ever touch the metrics actually on screen.
export const getBowlingMetrics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const frequency = req.query.frequency as string;
    const year = Number(req.query.year);
    const month = req.query.month !== undefined ? Number(req.query.month) : null;
    const search = (req.query.search as string)?.trim();

    const where: Prisma.MetricWhereInput = {
      organizationId: req.user!.organizationId,
      status: 'active',
      frequency: frequency as any,
    };
    if (search) where.title = { contains: search, mode: 'insensitive' };

    // Same department-OR-membership visibility as getMetrics.
    if (req.user!.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user!);
      where.OR = [{ departmentId: { in: accessibleIds ?? [] } }, { members: { some: { userId: req.user!.id } } }];
    }

    const metrics = await prisma.metric.findMany({
      where,
      include: METRIC_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const metricIds = metrics.map((m) => m.id);
    // month is only meaningful for 'daily' — every other frequency's period
    // key is year-only (see backend/utils/metricPeriods.ts), same convention
    // getPeriodData/savePeriodDiff already use.
    const docs = metricIds.length
      ? await MetricTracking.find({ metricId: { $in: metricIds }, year, month: frequency === 'daily' ? month : null })
      : [];

    const trackingByMetricId = new Map<number, { periods: Record<string, unknown>; actualTotal: number; targetTotal: number }>();
    for (const doc of docs) {
      const obj = doc.toObject({ flattenMaps: true });
      trackingByMetricId.set(obj.metricId, { periods: obj.periods, actualTotal: obj.actualTotal, targetTotal: obj.targetTotal });
    }

    const metricsWithTracking = metrics.map((m) => ({
      ...m,
      tracking: trackingByMetricId.get(m.id) ?? { periods: {}, actualTotal: 0, targetTotal: 0 },
    }));

    res.status(200).json({ metrics: metricsWithTracking });
  } catch (err) {
    next(err);
  }
};

// Unpaginated, ordered-for-drag-drop feed for the Tiles View — everything
// getMetrics' list already selects, plus `order`/`parentId`/`depth` (needed
// to group tiles into sibling sections) and a lightweight `parent` label for
// the "Under: <parent>" section heading on non-root groups.
const METRIC_TILE_INCLUDE = {
  ...METRIC_LIST_INCLUDE,
  parent: { select: { id: true, title: true } },
};

export const getMetricTiles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const where: Prisma.MetricWhereInput = { organizationId: req.user!.organizationId, status: 'active' };

    // Same department-OR-membership visibility as getMetrics.
    if (req.user!.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user!);
      where.OR = [{ departmentId: { in: accessibleIds ?? [] } }, { members: { some: { userId: req.user!.id } } }];
    }

    const metrics = await prisma.metric.findMany({
      where,
      include: METRIC_TILE_INCLUDE,
      orderBy: [{ parentId: 'asc' }, { order: 'asc' }],
    });

    res.status(200).json(metrics);
  } catch (err) {
    next(err);
  }
};

// Reorders one sibling group at a time — `order` is scoped per
// (organizationId, parentId) (see Metric.order's schema comment), and every
// metric sharing a `parentId` shares the same `depth` by construction, so
// validating the exact `parentId` group inherently keeps reordering
// depth-consistent without a separate depth check.
export const reorderMetrics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { parentId, orderedIds } = req.body;
    const parentIdNum = parentId === null || parentId === undefined ? null : Number(parentId);

    // Department-scoped like every other metric-mutating endpoint
    // (createMetric/updateMetric via canAccessDepartment) — without this, a
    // non-Admin could reorder metrics in a department they can't otherwise
    // see or edit, just by knowing/guessing its parentId.
    const where: Prisma.MetricWhereInput = {
      organizationId: req.user!.organizationId,
      parentId: parentIdNum,
      status: 'active',
    };
    if (req.user!.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user!);
      where.departmentId = { in: accessibleIds ?? [] };
    }

    const siblings = await prisma.metric.findMany({
      where,
      select: { id: true, organizationId: true, departmentId: true, members: { select: METRIC_MEMBERSHIP_SELECT } },
    });
    const siblingIds = new Set(siblings.map((m) => m.id));
    const numericIds = (orderedIds as (number | string)[]).map(Number);
    const uniqueIds = new Set(numericIds);

    if (
      uniqueIds.size !== numericIds.length ||
      numericIds.length !== siblingIds.size ||
      !numericIds.every((id) => siblingIds.has(id))
    )
      return next(new AppError('orderedIds must match exactly the active metrics under this parent', 400));

    // Reordering changes each metric's own `order` — a Viewer team member
    // shouldn't be able to do that just because they also have department
    // access, even though this endpoint is otherwise department-scoped
    // (not membership-widened) like createMetric/updateMetric's own checks.
    if (siblings.some((m) => !canEditMetric(req.user! as AuthUser, m)))
      return next(new AppError('You do not have edit access to reorder one or more of these metrics', 403));

    await prisma.$transaction(
      numericIds.map((id, index) => prisma.metric.update({ where: { id }, data: { order: index } }))
    );

    res.status(200).json({ message: 'Order updated' });
  } catch (err) {
    next(err);
  }
};

export const createMetric = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, department, category, owner, parentId, startDate, dueDate, notes, dataType, frequency, columnLabels } = req.body;

    const departmentId = Number(department);
    if (req.user!.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user!);
      if (!canAccessDepartment(accessibleIds, departmentId))
        return next(new AppError('You do not have access to this department', 403));
    }

    let depth = 0;
    if (parentId) {
      const parent = await prisma.metric.findUnique({
        where: { id: Number(parentId) },
        include: { members: { select: METRIC_MEMBERSHIP_SELECT } },
      });
      if (!parent) return next(new AppError('Parent metric not found', 404));
      if (!(await canAccessMetric(req.user! as AuthUser, parent)))
        return next(new AppError('You do not have access to the parent metric', 403));
      if (parent.depth >= MAX_METRIC_DEPTH)
        return next(new AppError(`Metrics can only be nested ${MAX_METRIC_DEPTH + 1} levels deep`, 400));
      depth = parent.depth + 1;
    }

    const order = await prisma.metric.count({
      where: { organizationId: req.user!.organizationId, parentId: parentId ? Number(parentId) : null },
    });

    const ownerId = Number(owner);

    const metric = await prisma.$transaction(async (tx) => {
      const sequenceId = await nextSequenceId(tx, req.user!.organizationId, 'metric');
      const created = await tx.metric.create({
        data: {
          title: title.trim(),
          departmentId,
          categoryId: category ? Number(category) : null,
          parentId: parentId ? Number(parentId) : null,
          depth,
          order,
          startDate: startDate || null,
          dueDate: dueDate || null,
          notes: notes ?? '',
          dataType: dataType ?? 'number',
          frequency: frequency ?? 'daily',
          columnLabels: columnLabels ? (columnLabels as Prisma.InputJsonValue) : Prisma.JsonNull,
          ownerId,
          createdById: req.user!.id,
          organizationId: req.user!.organizationId,
          sequenceId,
        },
      });

      // Seed the Team tab: the chosen Owner field's user becomes team
      // role 'owner'; whoever actually clicked Create becomes 'editor' —
      // skipped if they're the same person (they already got the 'owner'
      // row, no need for a second, lower row for the same user).
      await tx.metricMember.create({
        data: { metricId: created.id, userId: ownerId, role: 'owner', addedById: req.user!.id },
      });
      if (req.user!.id !== ownerId) {
        await tx.metricMember.create({
          data: { metricId: created.id, userId: req.user!.id, role: 'editor', addedById: req.user!.id },
        });
      }

      return tx.metric.findUniqueOrThrow({ where: { id: created.id }, include: METRIC_INCLUDE });
    });

    res.status(201).json({ message: 'Metric created', metric });
  } catch (err) {
    next(err);
  }
};

export const getMetricById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = await prisma.metric.findUnique({
      where: { id: Number(req.params.metricId) },
      include: METRIC_INCLUDE,
    });
    if (!metric) return next(new AppError('Metric not found', 404));

    if (!(await canAccessMetric(req.user! as AuthUser, metric)))
      return next(new AppError('You do not have access to this metric', 403));

    res.status(200).json(metric);
  } catch (err) {
    next(err);
  }
};

export const updateMetric = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = await prisma.metric.findUnique({
      where: { id: Number(req.params.metricId) },
      include: { members: { select: METRIC_MEMBERSHIP_SELECT } },
    });
    if (!metric) return next(new AppError('Metric not found', 404));

    if (!(await canAccessMetric(req.user! as AuthUser, metric)))
      return next(new AppError('You do not have access to this metric', 403));
    if (!canEditMetric(req.user! as AuthUser, metric))
      return next(new AppError('You do not have edit access to this metric', 403));
    // Locking freezes every field for everyone, including whoever would
    // otherwise have edit access — only lockMetric (owner/Admin only) can
    // change anything while locked, and that only touches isLocked itself.
    if (metric.isLocked)
      return next(new AppError('This metric is locked and cannot be edited', 403));

    const { title, department, category, owner, parentId, startDate, dueDate, notes, status, dataType, frequency, columnLabels } = req.body;

    // Switching frequency after Bowling View data has been entered would
    // silently strand it under the old (metricId, frequency) key with no
    // migration path yet — blocked outright for now rather than half-solving
    // it with a migrate-on-switch flow.
    if (frequency !== undefined && frequency !== metric.frequency) {
      const hasTrackingData = await MetricTracking.exists({ metricId: metric.id });
      if (hasTrackingData)
        return next(new AppError('This metric already has Bowling View data — its frequency can no longer be changed', 400));
    }

    const departmentId = department !== undefined ? Number(department) : undefined;
    if (departmentId !== undefined && req.user!.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user!);
      if (!canAccessDepartment(accessibleIds, departmentId))
        return next(new AppError('You do not have access to this department', 403));
    }

    const data: Prisma.MetricUncheckedUpdateInput = { updatedById: req.user!.id };
    if (title !== undefined) data.title = title.trim();
    if (departmentId !== undefined) data.departmentId = departmentId;
    if (category !== undefined) data.categoryId = category ? Number(category) : null;
    if (owner !== undefined) data.ownerId = Number(owner);
    if (startDate !== undefined) data.startDate = startDate || null;
    if (dueDate !== undefined) data.dueDate = dueDate || null;
    if (notes !== undefined) data.notes = notes;
    if (status !== undefined) data.status = status;
    if (dataType !== undefined) data.dataType = dataType;
    if (frequency !== undefined) data.frequency = frequency;
    // The Sheet tab's "Rename columns" popover sends the full desired
    // columnLabels object (or null to reset) — full-replace, same convention
    // as Project.tags rather than a per-key merge.
    if (columnLabels !== undefined) data.columnLabels = columnLabels ? (columnLabels as Prisma.InputJsonValue) : Prisma.JsonNull;

    if (parentId !== undefined) {
      if (parentId === null) {
        data.parentId = null;
        data.depth = 0;
      } else {
        if (Number(parentId) === metric.id)
          return next(new AppError('A metric cannot be its own parent', 400));
        const parent = await prisma.metric.findUnique({
          where: { id: Number(parentId) },
          include: { members: { select: METRIC_MEMBERSHIP_SELECT } },
        });
        if (!parent) return next(new AppError('Parent metric not found', 404));
        if (!(await canAccessMetric(req.user! as AuthUser, parent)))
          return next(new AppError('You do not have access to the parent metric', 403));
        if (parent.depth >= MAX_METRIC_DEPTH)
          return next(new AppError(`Metrics can only be nested ${MAX_METRIC_DEPTH + 1} levels deep`, 400));

        // Reject the parent being one of `metric`'s own descendants — walk up
        // from the chosen parent toward the root; if `metric.id` shows up on
        // that path, the parent is a descendant and this would create a cycle.
        let cursor: number | null = parent.parentId;
        while (cursor !== null) {
          if (cursor === metric.id)
            return next(new AppError("Cannot set one of a metric's own descendants as its parent", 400));
          const ancestor: { parentId: number | null } | null = await prisma.metric.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          });
          cursor = ancestor?.parentId ?? null;
        }

        data.parentId = parent.id;
        data.depth = parent.depth + 1;
      }
    }

    const updated = await prisma.metric.update({
      where: { id: metric.id },
      data,
      include: METRIC_INCLUDE,
    });

    res.status(200).json({ message: 'Metric updated', metric: updated });
  } catch (err) {
    next(err);
  }
};

// Toggles isLocked — deliberately its own endpoint rather than a field on
// updateMetric's body: the permission for THIS is canLockMetric (owner/Admin
// only), narrower than updateMetric's canEditMetric, and it must stay callable
// even while the metric is already locked (that's the only way to unlock it),
// unlike every other field updateMetric accepts.
export const lockMetric = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const metric = await prisma.metric.findUnique({
      where: { id: Number(req.params.metricId) },
      include: { members: { select: METRIC_MEMBERSHIP_SELECT } },
    });
    if (!metric) return next(new AppError('Metric not found', 404));

    if (!(await canAccessMetric(req.user! as AuthUser, metric)))
      return next(new AppError('You do not have access to this metric', 403));
    if (!canLockMetric(req.user! as AuthUser, metric))
      return next(new AppError('Only the metric owner or an Admin can lock or unlock this metric', 403));

    const { locked } = req.body;
    const updated = await prisma.metric.update({
      where: { id: metric.id },
      data: { isLocked: !!locked, updatedById: req.user!.id },
      include: METRIC_INCLUDE,
    });

    res.status(200).json({ message: locked ? 'Metric locked' : 'Metric unlocked', metric: updated });
  } catch (err) {
    next(err);
  }
};
