import Project from '../models/Project.js';
import ProjectItem from '../models/ProjectItem.js';
import Comment from '../models/Comment.js';
import Attachment from '../models/Attachment.js';
import AppError from '../utils/AppError.js';
import { deleteFile } from '../utils/gridfs.js';

const POPULATE_FIELDS = [
  { path: 'createdBy', select: 'username email role' },
  { path: 'owner', select: 'username email role' },
];

const getDescendantIds = async (rootId) => {
  const result = [];
  let frontier = [rootId];
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

    const [projects, total] = await Promise.all([
      Project.find().populate(POPULATE_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Project.countDocuments(),
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
    const { name, description, startDate, endDate, owner, priority } = req.body;

    const project = await Project.create({
      name: name.trim(),
      description: description ?? '',
      createdBy: req.user._id,
      owner: owner ?? req.user._id,
      priority: priority ?? 'medium',
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

    res.status(200).json(project);
  } catch (err) {
    next(err);
  }
};

export const updateProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));

    const { name, description, startDate, endDate, owner, priority } = req.body;
    if (name !== undefined) project.name = name.trim();
    if (description !== undefined) project.description = description;
    if (startDate !== undefined) project.startDate = startDate || null;
    if (endDate !== undefined) project.endDate = endDate || null;
    if (owner !== undefined) project.owner = owner || null;
    if (priority !== undefined) project.priority = priority;

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

    const topLevel = await ProjectItem.find({ project: project._id, parentId: null }).select('_id');
    const allItemIds = [...topLevel.map((t) => t._id)];
    for (const rootId of topLevel.map((t) => t._id)) {
      allItemIds.push(...(await getDescendantIds(rootId)));
    }

    if (allItemIds.length) {
      const attachments = await Attachment.find({ projectItem: { $in: allItemIds } });
      for (const attachment of attachments) {
        try {
          await deleteFile(attachment.gridFsId);
        } catch {
          // best-effort: continue cleanup even if a blob is already gone
        }
      }
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
