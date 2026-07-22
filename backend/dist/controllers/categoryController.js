import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
const USER_SELECT = { id: true, username: true, email: true, role: true };
const PROJECT_INCLUDE = {
    createdBy: { select: USER_SELECT },
    owner: { select: USER_SELECT },
};
// Accepts one root id or many — batches multiple roots into the same
// frontier so a multi-root walk costs one query per depth level total,
// instead of one full walk per root (mirrors the same pattern in
// projectController.js/utils/access.js, but walks Category, not Department).
const getDescendantIds = async (rootIds) => {
    const result = [];
    let frontier = Array.isArray(rootIds) ? rootIds : [rootIds];
    while (frontier.length) {
        const children = await prisma.category.findMany({
            where: { parentId: { in: frontier } },
            select: { id: true },
        });
        const ids = children.map((c) => c.id);
        result.push(...ids);
        frontier = ids;
    }
    return result;
};
const CATEGORY_INCLUDE = {
    createdBy: { select: USER_SELECT },
    updatedBy: { select: USER_SELECT },
    _count: { select: { projects: true, children: true } },
};
const withCounts = (c) => {
    const { _count, ...rest } = c;
    return { ...rest, projectCount: _count.projects, childCount: _count.children };
};
export const getCategories = async (req, res, next) => {
    try {
        if (req.query.page === undefined) {
            const categories = await prisma.category.findMany({
                where: { organizationId: req.user.organizationId },
                include: CATEGORY_INCLUDE,
                orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { order: 'asc' }],
            });
            return res.status(200).json(categories.map(withCounts));
        }
        // Paginated: same root-then-descendants approach as Departments, since
        // the tree is built client-side from parentId links and a page must
        // contain complete subtrees.
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
        const skip = (page - 1) * limit;
        const rootWhere = { organizationId: req.user.organizationId, parentId: null };
        const [total, roots] = await Promise.all([
            prisma.category.count({ where: rootWhere }),
            prisma.category.findMany({
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
        const categories = await prisma.category.findMany({
            where: { id: { in: allIds } },
            include: CATEGORY_INCLUDE,
            orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { order: 'asc' }],
        });
        res.status(200).json({
            categories: categories.map(withCounts),
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
export const createCategory = async (req, res, next) => {
    try {
        const { name, overview, color, parentId } = req.body;
        const parentIdNum = parentId ? Number(parentId) : null;
        let depth = 0;
        if (parentIdNum) {
            const parent = await prisma.category.findUnique({ where: { id: parentIdNum } });
            if (!parent || parent.organizationId !== req.user.organizationId)
                return next(new AppError('Parent category not found', 404));
            depth = parent.depth + 1;
        }
        const order = await prisma.category.count({ where: { parentId: parentIdNum } });
        const category = await prisma.category.create({
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
            include: CATEGORY_INCLUDE,
        });
        res.status(201).json({ message: 'Category created', category: withCounts(category) });
    }
    catch (err) {
        next(err);
    }
};
export const getCategoryById = async (req, res, next) => {
    try {
        const category = await prisma.category.findUnique({
            where: { id: Number(req.params.id) },
            include: CATEGORY_INCLUDE,
        });
        if (!category || category.organizationId !== req.user.organizationId)
            return next(new AppError('Category not found', 404));
        const [children, projects] = await Promise.all([
            prisma.category.findMany({ where: { parentId: category.id }, orderBy: { order: 'asc' } }),
            prisma.project.findMany({ where: { categoryId: category.id }, include: PROJECT_INCLUDE }),
        ]);
        res.status(200).json({ category: withCounts(category), children, projects });
    }
    catch (err) {
        next(err);
    }
};
export const updateCategory = async (req, res, next) => {
    try {
        const category = await prisma.category.findUnique({ where: { id: Number(req.params.id) } });
        if (!category || category.organizationId !== req.user.organizationId)
            return next(new AppError('Category not found', 404));
        const { name, overview, color } = req.body;
        const data = { updatedById: req.user.id };
        if (name !== undefined)
            data.name = name.trim();
        if (overview !== undefined)
            data.overview = overview;
        if (color !== undefined)
            data.color = color;
        const updated = await prisma.category.update({
            where: { id: category.id },
            data,
            include: CATEGORY_INCLUDE,
        });
        res.status(200).json({ message: 'Category updated', category: withCounts(updated) });
    }
    catch (err) {
        next(err);
    }
};
export const deleteCategory = async (req, res, next) => {
    try {
        const category = await prisma.category.findUnique({ where: { id: Number(req.params.id) } });
        if (!category || category.organizationId !== req.user.organizationId)
            return next(new AppError('Category not found', 404));
        const descendantIds = await getDescendantIds(category.id);
        const allIds = [category.id, ...descendantIds];
        await prisma.$transaction([
            prisma.project.updateMany({ where: { categoryId: { in: allIds } }, data: { categoryId: null } }),
            prisma.category.deleteMany({ where: { id: { in: allIds } } }),
        ]);
        res.status(200).json({ message: 'Category deleted' });
    }
    catch (err) {
        next(err);
    }
};
//# sourceMappingURL=categoryController.js.map