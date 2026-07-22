import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { getAccessibleDepartmentIds, canAccessDepartment, getDescendantIds, canManageRole } from '../utils/access.js';
const USER_SELECT = { id: true, username: true, email: true, role: true };
const DEPARTMENT_INCLUDE = {
    createdBy: { select: USER_SELECT },
    updatedBy: { select: USER_SELECT },
    _count: { select: { users: true, projects: true, children: true } },
};
// Flattens Prisma's relation _count into the flat userCount/projectCount/
// childCount shape the frontend expects.
const withCounts = (d) => {
    const { _count, ...rest } = d;
    return { ...rest, userCount: _count.users, projectCount: _count.projects, childCount: _count.children };
};
// Admins and Managers see every department in the organization; Team Leads
// and Users are scoped to their assigned subtree. This is deliberately wider
// than getAccessibleDepartmentIds's usual meaning (which still scopes Manager
// department creation/edits) — viewing the org chart is not a mutation.
const getViewableDepartmentIds = (user) => user.role === 'Admin' || user.role === 'Manager' ? Promise.resolve(null) : getAccessibleDepartmentIds(user);
export const getDepartments = async (req, res, next) => {
    try {
        const accessibleIds = await getViewableDepartmentIds(req.user);
        if (req.query.page === undefined) {
            const where = { organizationId: req.user.organizationId };
            if (accessibleIds !== null)
                where.id = { in: accessibleIds };
            const departments = await prisma.department.findMany({
                where,
                include: DEPARTMENT_INCLUDE,
                orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { order: 'asc' }],
            });
            return res.status(200).json(departments.map(withCounts));
        }
        // Paginated: the tree is built client-side from parentId links, so a page
        // must contain complete subtrees, never orphaned children whose parent
        // landed on a different page. Paginate over root-level departments only,
        // then pull in every descendant of that page's roots regardless of depth.
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
        const skip = (page - 1) * limit;
        const rootWhere = { organizationId: req.user.organizationId, parentId: null };
        if (accessibleIds !== null)
            rootWhere.id = { in: accessibleIds };
        const [total, roots] = await Promise.all([
            prisma.department.count({ where: rootWhere }),
            prisma.department.findMany({
                where: rootWhere,
                orderBy: { order: 'asc' },
                skip,
                take: limit,
                select: { id: true },
            }),
        ]);
        const rootIds = roots.map((r) => r.id);
        const descendantIds = await getDescendantIds(rootIds);
        const allIds = [...rootIds, ...descendantIds];
        const departments = await prisma.department.findMany({
            where: { id: { in: allIds } },
            include: DEPARTMENT_INCLUDE,
            orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { order: 'asc' }],
        });
        res.status(200).json({
            departments: departments.map(withCounts),
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
export const createDepartment = async (req, res, next) => {
    try {
        const { name, overview, color, parentId } = req.body;
        const parentIdNum = parentId ? Number(parentId) : null;
        if (req.user.role === 'Manager') {
            if (!parentIdNum)
                return next(new AppError('Managers can only create sub-departments within their assigned departments', 403));
            const accessibleIds = await getAccessibleDepartmentIds(req.user);
            if (!canAccessDepartment(accessibleIds, parentIdNum))
                return next(new AppError('You do not have access to this department', 403));
        }
        let depth = 0;
        if (parentIdNum) {
            const parent = await prisma.department.findUnique({ where: { id: parentIdNum } });
            if (!parent || parent.organizationId !== req.user.organizationId)
                return next(new AppError('Parent department not found', 404));
            depth = parent.depth + 1;
        }
        const order = await prisma.department.count({ where: { parentId: parentIdNum } });
        const department = await prisma.department.create({
            data: {
                name: name.trim(),
                overview: overview ?? '',
                color: color ?? '#3b82f6',
                parentId: parentIdNum,
                organizationId: req.user.organizationId,
                depth,
                order,
                createdById: req.user.id,
            },
            include: DEPARTMENT_INCLUDE,
        });
        res.status(201).json({ message: 'Department created', department: withCounts(department) });
    }
    catch (err) {
        next(err);
    }
};
export const getDepartmentById = async (req, res, next) => {
    try {
        const department = await prisma.department.findUnique({
            where: { id: Number(req.params.id) },
            include: DEPARTMENT_INCLUDE,
        });
        if (!department || department.organizationId !== req.user.organizationId)
            return next(new AppError('Department not found', 404));
        const accessibleIds = await getViewableDepartmentIds(req.user);
        if (!canAccessDepartment(accessibleIds, department.id))
            return next(new AppError('You do not have access to this department', 403));
        const [children, users, projects] = await Promise.all([
            prisma.department.findMany({ where: { parentId: department.id }, orderBy: { order: 'asc' } }),
            prisma.user.findMany({
                where: { departments: { some: { id: department.id } } },
                omit: { password: true },
            }),
            prisma.project.findMany({
                where: { departmentId: department.id },
                include: {
                    createdBy: { select: USER_SELECT },
                    owner: { select: USER_SELECT },
                },
            }),
        ]);
        res.status(200).json({ department: withCounts(department), children, users, projects });
    }
    catch (err) {
        next(err);
    }
};
export const updateDepartment = async (req, res, next) => {
    try {
        const department = await prisma.department.findUnique({ where: { id: Number(req.params.id) } });
        if (!department || department.organizationId !== req.user.organizationId)
            return next(new AppError('Department not found', 404));
        if (req.user.role === 'Manager') {
            const accessibleIds = await getAccessibleDepartmentIds(req.user);
            if (!canAccessDepartment(accessibleIds, department.id))
                return next(new AppError('You do not have access to this department', 403));
        }
        const { name, overview, color } = req.body;
        const data = { updatedById: req.user.id };
        if (name !== undefined)
            data.name = name.trim();
        if (overview !== undefined)
            data.overview = overview;
        if (color !== undefined)
            data.color = color;
        const updated = await prisma.department.update({
            where: { id: department.id },
            data,
            include: DEPARTMENT_INCLUDE,
        });
        res.status(200).json({ message: 'Department updated', department: withCounts(updated) });
    }
    catch (err) {
        next(err);
    }
};
export const deleteDepartment = async (req, res, next) => {
    try {
        const department = await prisma.department.findUnique({
            where: { id: Number(req.params.id) },
            include: { createdBy: { select: { id: true, role: true } } },
        });
        if (!department || department.organizationId !== req.user.organizationId)
            return next(new AppError('Department not found', 404));
        // Managers may delete a department they created themselves, or one
        // created by a strictly lower-ranked role (never an Admin's, and never
        // another Manager's) — mirrors canManageRole's use for user management.
        if (req.user.role === 'Manager') {
            const isOwnCreation = department.createdBy.id === req.user.id;
            if (!isOwnCreation && !canManageRole(req.user.role, department.createdBy.role))
                return next(new AppError('You do not have permission to delete this department', 403));
        }
        const descendantIds = await getDescendantIds(department.id);
        const allIds = [department.id, ...descendantIds];
        // User<->Department and Invite<->Department memberships are implicit m2m
        // relations that Prisma manages with an ON DELETE CASCADE join table, so
        // they clean themselves up automatically once the departments are gone.
        await prisma.$transaction([
            prisma.project.updateMany({ where: { departmentId: { in: allIds } }, data: { departmentId: null } }),
            prisma.department.deleteMany({ where: { id: { in: allIds } } }),
        ]);
        res.status(200).json({ message: 'Department deleted' });
    }
    catch (err) {
        next(err);
    }
};
//# sourceMappingURL=departmentController.js.map