import Category from '../models/Category.js';
import Project from '../models/Project.js';
import AppError from '../utils/AppError.js';

const POPULATE_FIELDS = [
  { path: 'createdBy', select: 'username email role' },
  { path: 'updatedBy', select: 'username email role' },
];
const PROJECT_POPULATE_FIELDS = [
  { path: 'createdBy', select: 'username email role' },
  { path: 'owner', select: 'username email role' },
];

const sameOrg = (a, b) => String(a ?? '') === String(b ?? '');

// Accepts one root or many — batching multiple roots into the same frontier
// keeps this to one query per depth level total, instead of one full walk
// per root (mirrors the same pattern in projectController.js/utils/access.js).
const getDescendantIds = async (rootIds) => {
  const result = [];
  let frontier = Array.isArray(rootIds) ? rootIds : [rootIds];
  while (frontier.length) {
    const children = await Category.find({ parentId: { $in: frontier } }).select('_id');
    const ids = children.map((c) => c._id);
    result.push(...ids);
    frontier = ids;
  }
  return result;
};

// Merges projectCount/childCount onto each category. Both aggregates are
// org-agnostic (they describe absolute usage across the whole collection),
// so the same merge works whether `categories` is the full org list or a
// single page's worth.
const attachCounts = async (categories) => {
  const [projectCounts, childCounts] = await Promise.all([
    Project.aggregate([
      { $match: { category: { $ne: null } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),
    Category.aggregate([
      { $match: { parentId: { $ne: null } } },
      { $group: { _id: '$parentId', count: { $sum: 1 } } },
    ]),
  ]);

  const toMap = (rows) => new Map(rows.map((r) => [String(r._id), r.count]));
  const projectCountMap = toMap(projectCounts);
  const childCountMap = toMap(childCounts);

  return categories.map((c) => ({
    ...c.toObject(),
    projectCount: projectCountMap.get(String(c._id)) ?? 0,
    childCount: childCountMap.get(String(c._id)) ?? 0,
  }));
};

export const getCategories = async (req, res, next) => {
  try {
    if (req.query.page === undefined) {
      const categories = await Category.find({ organization: req.user.organization })
        .populate(POPULATE_FIELDS)
        .sort({ parentId: 1, order: 1 });

      return res.status(200).json(await attachCounts(categories));
    }

    // Paginated: same root-then-descendants approach as Departments, since
    // the tree is built client-side from parentId links and a page must
    // contain complete subtrees.
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    const rootFilter = { organization: req.user.organization, parentId: null };

    const [total, roots] = await Promise.all([
      Category.countDocuments(rootFilter),
      Category.find(rootFilter).sort({ order: 1 }).skip(skip).limit(limit).select('_id'),
    ]);

    const rootIds = roots.map((r) => r._id);
    const descendantIds = await getDescendantIds(rootIds);
    const allIds = [...rootIds, ...descendantIds];

    const categories = await Category.find({ _id: { $in: allIds } })
      .populate(POPULATE_FIELDS)
      .sort({ parentId: 1, order: 1 });

    res.status(200).json({
      categories: await attachCounts(categories),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const createCategory = async (req, res, next) => {
  try {
    const { name, overview, color, parentId } = req.body;

    let depth = 0;
    if (parentId) {
      const parent = await Category.findById(parentId);
      if (!parent || !sameOrg(parent.organization, req.user.organization))
        return next(new AppError('Parent category not found', 404));
      depth = parent.depth + 1;
    }

    const order = await Category.countDocuments({ parentId: parentId ?? null });

    const category = await Category.create({
      name: name.trim(),
      overview: overview ?? '',
      color: color ?? '#3b82f6',
      parentId: parentId ?? null,
      organization: req.user.organization,
      depth,
      order,
      createdBy: req.user._id,
    });

    const populated = await category.populate(POPULATE_FIELDS);
    res.status(201).json({ message: 'Category created', category: populated });
  } catch (err) {
    next(err);
  }
};

export const getCategoryById = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!category || !sameOrg(category.organization, req.user.organization))
      return next(new AppError('Category not found', 404));

    const [children, projects] = await Promise.all([
      Category.find({ parentId: category._id }).sort({ order: 1 }),
      Project.find({ category: category._id }).populate(PROJECT_POPULATE_FIELDS),
    ]);

    res.status(200).json({ category, children, projects });
  } catch (err) {
    next(err);
  }
};

export const updateCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category || !sameOrg(category.organization, req.user.organization))
      return next(new AppError('Category not found', 404));

    const { name, overview, color } = req.body;
    if (name !== undefined) category.name = name.trim();
    if (overview !== undefined) category.overview = overview;
    if (color !== undefined) category.color = color;
    category.updatedBy = req.user._id;

    await category.save();

    const populated = await category.populate(POPULATE_FIELDS);
    res.status(200).json({ message: 'Category updated', category: populated });
  } catch (err) {
    next(err);
  }
};

export const deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category || !sameOrg(category.organization, req.user.organization))
      return next(new AppError('Category not found', 404));

    const descendantIds = await getDescendantIds(category._id);
    const allIds = [category._id, ...descendantIds];

    await Project.updateMany({ category: { $in: allIds } }, { $set: { category: null } });
    await Category.deleteMany({ _id: { $in: allIds } });

    res.status(200).json({ message: 'Category deleted' });
  } catch (err) {
    next(err);
  }
};
