import Project from '../models/Project.js';
import ProjectItem from '../models/ProjectItem.js';
import Comment from '../models/Comment.js';
import Attachment from '../models/Attachment.js';
import AppError from '../utils/AppError.js';
import { deleteFile } from '../utils/gridfs.js';
import { getAccessibleDepartmentIds, canAccessDepartment } from '../utils/access.js';

const POPULATE_FIELDS = [
  { path: 'createdBy', select: 'username email role' },
  { path: 'owner', select: 'username email role' },
  { path: 'department', select: 'name color' },
];

// Admins see every project in their organization. Everyone else sees
// projects whose department is within their accessible scope, plus
// department-less ("personal") projects they created or own.
export const canAccessProject = async (user, project) => {
  if (String(project.organization ?? '') !== String(user.organization ?? '')) return false;
  if (user.role === 'Admin') return true;

  if (!project.department) {
    return String(project.createdBy) === String(user._id) || String(project.owner) === String(user._id);
  }

  const accessibleIds = await getAccessibleDepartmentIds(user);
  return canAccessDepartment(accessibleIds, project.department);
};

// Editing/deleting a project's own settings (as opposed to working within its
// item tree) is reserved for Admins, Managers (within their department
// scope, enforced by canAccessProject already having been checked), and the
// project's own creator/owner.
export const canManageProjectSettings = (user, project) =>
  user.role === 'Admin' ||
  user.role === 'Manager' ||
  String(project.createdBy) === String(user._id) ||
  String(project.owner) === String(user._id);

// Accepts one root or many — batching multiple roots into the same frontier
// keeps this to one query per depth level total, instead of one full walk
// per root.
const getDescendantIds = async (rootIds) => {
  const result = [];
  let frontier = Array.isArray(rootIds) ? rootIds : [rootIds];
  while (frontier.length) {
    const children = await ProjectItem.find({ parentId: { $in: frontier } }).select('_id');
    const ids = children.map((c) => c._id);
    result.push(...ids);
    frontier = ids;
  }
  return result;
};

export const getProjects = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    const filter = { organization: req.user.organization };

    if (req.user.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      filter.$or = [
        { department: { $in: accessibleIds } },
        { department: null, createdBy: req.user._id },
        { department: null, owner: req.user._id },
      ];
    }

    const [projects, total] = await Promise.all([
      Project.find(filter).populate(POPULATE_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Project.countDocuments(filter),
    ]);

    res.status(200).json({
      projects,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const createProject = async (req, res, next) => {
  try {
    const { name, description, startDate, endDate, owner, priority, department } = req.body;

    if (department && req.user.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      if (!canAccessDepartment(accessibleIds, department))
        return next(new AppError('You do not have access to this department', 403));
    }

    const project = await Project.create({
      name: name.trim(),
      description: description ?? '',
      createdBy: req.user._id,
      owner: owner ?? req.user._id,
      priority: priority ?? 'medium',
      department: department ?? null,
      organization: req.user.organization,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
    });

    const populated = await project.populate(POPULATE_FIELDS);
    res.status(201).json({ message: 'Project created', project: populated });
  } catch (err) {
    next(err);
  }
};

export const getProjectById = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId).populate(POPULATE_FIELDS);
    if (!project) return next(new AppError('Project not found', 404));

    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    res.status(200).json(project);
  } catch (err) {
    next(err);
  }
};

export const updateProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));

    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageProjectSettings(req.user, project))
      return next(new AppError('You do not have permission to update this project', 403));

    const { name, description, startDate, endDate, owner, priority, department } = req.body;

    if (department && req.user.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      if (!canAccessDepartment(accessibleIds, department))
        return next(new AppError('You do not have access to this department', 403));
    }

    if (name !== undefined) project.name = name.trim();
    if (description !== undefined) project.description = description;
    if (startDate !== undefined) project.startDate = startDate || null;
    if (endDate !== undefined) project.endDate = endDate || null;
    if (owner !== undefined) project.owner = owner || null;
    if (priority !== undefined) project.priority = priority;
    if (department !== undefined) project.department = department || null;

    await project.save();

    const populated = await project.populate(POPULATE_FIELDS);
    res.status(200).json({ message: 'Project updated', project: populated });
  } catch (err) {
    next(err);
  }
};

export const deleteProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));

    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageProjectSettings(req.user, project))
      return next(new AppError('You do not have permission to delete this project', 403));

    const topLevel = await ProjectItem.find({ project: project._id, parentId: null }).select('_id');
    const topLevelIds = topLevel.map((t) => t._id);
    const allItemIds = [...topLevelIds, ...(await getDescendantIds(topLevelIds))];

    if (allItemIds.length) {
      const attachments = await Attachment.find({ projectItem: { $in: allItemIds } });
      // best-effort: blob deletions are independent I/O, run concurrently and
      // continue cleanup even if some blobs are already gone
      await Promise.allSettled(attachments.map((a) => deleteFile(a.gridFsId)));
      await Attachment.deleteMany({ projectItem: { $in: allItemIds } });
      await Comment.deleteMany({ projectItem: { $in: allItemIds } });
      await ProjectItem.deleteMany({ _id: { $in: allItemIds } });
    }

    await Project.findByIdAndDelete(project._id);
    res.status(200).json({ message: 'Project deleted' });
  } catch (err) {
    next(err);
  }
};
