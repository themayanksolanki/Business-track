import Department from '../models/Department.js';
import User from '../models/User.js';
import Project from '../models/Project.js';
import AppError from '../utils/AppError.js';
import { getAccessibleDepartmentIds, canAccessDepartment, getDescendantIds } from '../utils/access.js';

const POPULATE_FIELDS = [{ path: 'createdBy', select: 'username email role' }];
const PROJECT_POPULATE_FIELDS = [
  { path: 'createdBy', select: 'username email role' },
  { path: 'owner', select: 'username email role' },
];

const sameOrg = (a, b) => String(a ?? '') === String(b ?? '');

export const getDepartments = async (req, res, next) => {
  try {
    const accessibleIds = await getAccessibleDepartmentIds(req.user);
    const filter = { organization: req.user.organization };
    if (accessibleIds !== null) filter._id = { $in: accessibleIds };

    const departments = await Department.find(filter)
      .populate(POPULATE_FIELDS)
      .sort({ parentId: 1, order: 1 });

    const [userCounts, projectCounts, childCounts] = await Promise.all([
      User.aggregate([
        { $unwind: '$departments' },
        { $group: { _id: '$departments', count: { $sum: 1 } } },
      ]),
      Project.aggregate([
        { $match: { department: { $ne: null } } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
      ]),
      Department.aggregate([
        { $match: { parentId: { $ne: null } } },
        { $group: { _id: '$parentId', count: { $sum: 1 } } },
      ]),
    ]);

    const toMap = (rows) => new Map(rows.map((r) => [String(r._id), r.count]));
    const userCountMap = toMap(userCounts);
    const projectCountMap = toMap(projectCounts);
    const childCountMap = toMap(childCounts);

    const withCounts = departments.map((d) => ({
      ...d.toObject(),
      userCount: userCountMap.get(String(d._id)) ?? 0,
      projectCount: projectCountMap.get(String(d._id)) ?? 0,
      childCount: childCountMap.get(String(d._id)) ?? 0,
    }));

    res.status(200).json(withCounts);
  } catch (err) {
    next(err);
  }
};

export const createDepartment = async (req, res, next) => {
  try {
    const { name, overview, color, parentId } = req.body;

    if (req.user.role === 'Manager') {
      if (!parentId)
        return next(
          new AppError('Managers can only create sub-departments within their assigned departments', 403)
        );
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      if (!canAccessDepartment(accessibleIds, parentId))
        return next(new AppError('You do not have access to this department', 403));
    }

    let depth = 0;
    if (parentId) {
      const parent = await Department.findById(parentId);
      if (!parent || !sameOrg(parent.organization, req.user.organization))
        return next(new AppError('Parent department not found', 404));
      depth = parent.depth + 1;
    }

    const order = await Department.countDocuments({ parentId: parentId ?? null });

    const department = await Department.create({
      name: name.trim(),
      overview: overview ?? '',
      color: color ?? '#3b82f6',
      parentId: parentId ?? null,
      organization: req.user.organization,
      depth,
      order,
      createdBy: req.user._id,
    });

    const populated = await department.populate(POPULATE_FIELDS);
    res.status(201).json({ message: 'Department created', department: populated });
  } catch (err) {
    next(err);
  }
};

export const getDepartmentById = async (req, res, next) => {
  try {
    const department = await Department.findById(req.params.id).populate(POPULATE_FIELDS);
    if (!department || !sameOrg(department.organization, req.user.organization))
      return next(new AppError('Department not found', 404));

    const accessibleIds = await getAccessibleDepartmentIds(req.user);
    if (!canAccessDepartment(accessibleIds, department._id))
      return next(new AppError('You do not have access to this department', 403));

    const [children, users, projects] = await Promise.all([
      Department.find({ parentId: department._id }).sort({ order: 1 }),
      User.find({ departments: department._id }).select('-password'),
      Project.find({ department: department._id }).populate(PROJECT_POPULATE_FIELDS),
    ]);

    res.status(200).json({ department, children, users, projects });
  } catch (err) {
    next(err);
  }
};

export const updateDepartment = async (req, res, next) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department || !sameOrg(department.organization, req.user.organization))
      return next(new AppError('Department not found', 404));

    if (req.user.role === 'Manager') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      if (!canAccessDepartment(accessibleIds, department._id))
        return next(new AppError('You do not have access to this department', 403));
    }

    const { name, overview, color } = req.body;
    if (name !== undefined) department.name = name.trim();
    if (overview !== undefined) department.overview = overview;
    if (color !== undefined) department.color = color;

    await department.save();

    const populated = await department.populate(POPULATE_FIELDS);
    res.status(200).json({ message: 'Department updated', department: populated });
  } catch (err) {
    next(err);
  }
};

export const deleteDepartment = async (req, res, next) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department || !sameOrg(department.organization, req.user.organization))
      return next(new AppError('Department not found', 404));

    if (req.user.role === 'Manager') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      if (!canAccessDepartment(accessibleIds, department._id))
        return next(new AppError('You do not have access to this department', 403));
    }

    const descendantIds = await getDescendantIds(department._id);
    const allIds = [department._id, ...descendantIds];

    await Promise.all([
      User.updateMany({ departments: { $in: allIds } }, { $pull: { departments: { $in: allIds } } }),
      Project.updateMany({ department: { $in: allIds } }, { $set: { department: null } }),
    ]);
    await Department.deleteMany({ _id: { $in: allIds } });

    res.status(200).json({ message: 'Department deleted' });
  } catch (err) {
    next(err);
  }
};
