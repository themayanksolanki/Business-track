import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { getAccessibleDepartmentIds, canAccessDepartment } from '../utils/access.js';
import { nextSequenceId } from '../utils/sequence.js';
const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };
const METRIC_INCLUDE = {
    department: { select: { id: true, name: true, color: true } },
    category: { select: { id: true, name: true, color: true } },
    owner: { select: USER_SELECT },
    createdBy: { select: USER_SELECT },
    updatedBy: { select: USER_SELECT },
    parent: { select: { id: true, title: true } },
};
// Lightweight include for the list view — only what the Metrics page table
// actually renders (name, department, owner), mirroring how projectController
// keeps a reduced ACCESS_INCLUDE separate from the full PROJECT_INCLUDE.
const METRIC_LIST_INCLUDE = {
    department: { select: { id: true, name: true, color: true } },
    owner: { select: USER_SELECT },
};
// Single access check reused for both read and write — Metric has no
// membership/edit-vs-view concept (unlike Project's canAccessProject/
// canEditProject split): anyone who can see a metric can also manage its
// config and enter its data.
export const canAccessMetric = async (user, metric) => {
    if (metric.organizationId !== user.organizationId)
        return false;
    if (user.role === 'Admin')
        return true;
    const accessibleIds = await getAccessibleDepartmentIds(user);
    return canAccessDepartment(accessibleIds, metric.departmentId);
};
const VALID_METRIC_STATUSES = ['active', 'archived', 'deleted'];
// depths 0-6 => 7 levels total, mirroring ProjectItem's MAX_DEPTH
// (backend/services/statusSync.service.ts) at a slightly deeper cap.
const MAX_METRIC_DEPTH = 6;
export const getMetrics = async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const skip = (page - 1) * limit;
        const where = { organizationId: req.user.organizationId };
        if (req.query.status === 'all') {
            // no status filter — every status, including archived/deleted
        }
        else if (VALID_METRIC_STATUSES.includes(req.query.status)) {
            where.status = req.query.status;
        }
        else {
            where.status = 'active';
        }
        if (req.user.role !== 'Admin') {
            const accessibleIds = await getAccessibleDepartmentIds(req.user);
            where.departmentId = { in: accessibleIds ?? [] };
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
    }
    catch (err) {
        next(err);
    }
};
export const createMetric = async (req, res, next) => {
    try {
        const { title, department, category, owner, parentId, startDate, dueDate, notes, dataType } = req.body;
        const departmentId = Number(department);
        if (req.user.role !== 'Admin') {
            const accessibleIds = await getAccessibleDepartmentIds(req.user);
            if (!canAccessDepartment(accessibleIds, departmentId))
                return next(new AppError('You do not have access to this department', 403));
        }
        let depth = 0;
        if (parentId) {
            const parent = await prisma.metric.findUnique({ where: { id: Number(parentId) } });
            if (!parent)
                return next(new AppError('Parent metric not found', 404));
            if (!(await canAccessMetric(req.user, parent)))
                return next(new AppError('You do not have access to the parent metric', 403));
            if (parent.depth >= MAX_METRIC_DEPTH)
                return next(new AppError(`Metrics can only be nested ${MAX_METRIC_DEPTH + 1} levels deep`, 400));
            depth = parent.depth + 1;
        }
        const order = await prisma.metric.count({
            where: { organizationId: req.user.organizationId, parentId: parentId ? Number(parentId) : null },
        });
        const metric = await prisma.$transaction(async (tx) => {
            const sequenceId = await nextSequenceId(tx, req.user.organizationId, 'metric');
            return tx.metric.create({
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
                    ownerId: Number(owner),
                    createdById: req.user.id,
                    organizationId: req.user.organizationId,
                    sequenceId,
                },
                include: METRIC_INCLUDE,
            });
        });
        res.status(201).json({ message: 'Metric created', metric });
    }
    catch (err) {
        next(err);
    }
};
export const getMetricById = async (req, res, next) => {
    try {
        const metric = await prisma.metric.findUnique({
            where: { id: Number(req.params.metricId) },
            include: METRIC_INCLUDE,
        });
        if (!metric)
            return next(new AppError('Metric not found', 404));
        if (!(await canAccessMetric(req.user, metric)))
            return next(new AppError('You do not have access to this metric', 403));
        res.status(200).json(metric);
    }
    catch (err) {
        next(err);
    }
};
export const updateMetric = async (req, res, next) => {
    try {
        const metric = await prisma.metric.findUnique({ where: { id: Number(req.params.metricId) } });
        if (!metric)
            return next(new AppError('Metric not found', 404));
        if (!(await canAccessMetric(req.user, metric)))
            return next(new AppError('You do not have access to this metric', 403));
        const { title, department, category, owner, parentId, startDate, dueDate, notes, status, dataType } = req.body;
        const departmentId = department !== undefined ? Number(department) : undefined;
        if (departmentId !== undefined && req.user.role !== 'Admin') {
            const accessibleIds = await getAccessibleDepartmentIds(req.user);
            if (!canAccessDepartment(accessibleIds, departmentId))
                return next(new AppError('You do not have access to this department', 403));
        }
        const data = { updatedById: req.user.id };
        if (title !== undefined)
            data.title = title.trim();
        if (departmentId !== undefined)
            data.departmentId = departmentId;
        if (category !== undefined)
            data.categoryId = category ? Number(category) : null;
        if (owner !== undefined)
            data.ownerId = Number(owner);
        if (startDate !== undefined)
            data.startDate = startDate || null;
        if (dueDate !== undefined)
            data.dueDate = dueDate || null;
        if (notes !== undefined)
            data.notes = notes;
        if (status !== undefined)
            data.status = status;
        if (dataType !== undefined)
            data.dataType = dataType;
        if (parentId !== undefined) {
            if (parentId === null) {
                data.parentId = null;
                data.depth = 0;
            }
            else {
                if (Number(parentId) === metric.id)
                    return next(new AppError('A metric cannot be its own parent', 400));
                const parent = await prisma.metric.findUnique({ where: { id: Number(parentId) } });
                if (!parent)
                    return next(new AppError('Parent metric not found', 404));
                if (!(await canAccessMetric(req.user, parent)))
                    return next(new AppError('You do not have access to the parent metric', 403));
                if (parent.depth >= MAX_METRIC_DEPTH)
                    return next(new AppError(`Metrics can only be nested ${MAX_METRIC_DEPTH + 1} levels deep`, 400));
                // Reject the parent being one of `metric`'s own descendants — walk up
                // from the chosen parent toward the root; if `metric.id` shows up on
                // that path, the parent is a descendant and this would create a cycle.
                let cursor = parent.parentId;
                while (cursor !== null) {
                    if (cursor === metric.id)
                        return next(new AppError("Cannot set one of a metric's own descendants as its parent", 400));
                    const ancestor = await prisma.metric.findUnique({
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
    }
    catch (err) {
        next(err);
    }
};
//# sourceMappingURL=metricController.js.map