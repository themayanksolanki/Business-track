import ProjectItem from '../models/ProjectItem.js';
import Project from '../models/Project.js';
import Comment from '../models/Comment.js';
import Attachment from '../models/Attachment.js';
import AppError from '../utils/AppError.js';
import { deleteFile } from '../utils/gridfs.js';
import { MAX_DEPTH, typeForDepth, recomputeAncestorStatuses } from '../services/statusSync.service.js';

const POPULATE_FIELDS = [
  { path: 'assignedTo', select: 'username email role' },
  { path: 'createdBy', select: 'username email role' },
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

export const getItems = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));

    const items = await ProjectItem.find({ project: project._id })
      .populate(POPULATE_FIELDS)
      .sort({ parentId: 1, order: 1 });

    res.status(200).json(items);
  } catch (err) {
    next(err);
  }
};

export const createItem = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));

    const { title, description, priority, assignedTo, parentId, startDate, endDate } = req.body;

    let depth = 0;
    let parent = null;

    if (parentId) {
      parent = await ProjectItem.findById(parentId);
      if (!parent || String(parent.project) !== String(project._id))
        return next(new AppError('Parent item not found in this project', 404));

      if (parent.depth >= MAX_DEPTH)
        return next(new AppError(`Maximum hierarchy depth of ${MAX_DEPTH + 1} levels reached`, 400));

      depth = parent.depth + 1;
    }

    const order = await ProjectItem.countDocuments({ project: project._id, parentId: parentId ?? null });

    const item = await ProjectItem.create({
      project: project._id,
      parentId: parentId ?? null,
      type: typeForDepth(depth),
      title: title.trim(),
      description: description ?? '',
      priority: priority ?? 'medium',
      assignedTo: assignedTo ?? null,
      createdBy: req.user._id,
      depth,
      order,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
    });

    if (parent) await recomputeAncestorStatuses(parent._id);

    const populated = await item.populate(POPULATE_FIELDS);
    res.status(201).json({ message: 'Item created', item: populated });
  } catch (err) {
    next(err);
  }
};

export const getItemById = async (req, res, next) => {
  try {
    const item = await ProjectItem.findOne({
      _id: req.params.itemId,
      project: req.params.projectId,
    }).populate(POPULATE_FIELDS);
    if (!item) return next(new AppError('Item not found', 404));

    res.status(200).json(item);
  } catch (err) {
    next(err);
  }
};

export const updateItem = async (req, res, next) => {
  try {
    const item = await ProjectItem.findOne({ _id: req.params.itemId, project: req.params.projectId });
    if (!item) return next(new AppError('Item not found', 404));

    const { title, description, priority, assignedTo, status, startDate, endDate } = req.body;

    if (status !== undefined) {
      const childCount = await ProjectItem.countDocuments({ parentId: item._id });
      if (childCount > 0)
        return next(new AppError('Status is derived from children and cannot be set directly', 400));
      item.status = status;
    }

    if (title !== undefined) item.title = title.trim();
    if (description !== undefined) item.description = description;
    if (priority !== undefined) item.priority = priority;
    if (assignedTo !== undefined) item.assignedTo = assignedTo || null;
    if (startDate !== undefined) item.startDate = startDate || null;
    if (endDate !== undefined) item.endDate = endDate || null;

    await item.save();

    if (status !== undefined) await recomputeAncestorStatuses(item.parentId);

    const populated = await item.populate(POPULATE_FIELDS);
    res.status(200).json({ message: 'Item updated', item: populated });
  } catch (err) {
    next(err);
  }
};

export const deleteItem = async (req, res, next) => {
  try {
    const item = await ProjectItem.findOne({ _id: req.params.itemId, project: req.params.projectId });
    if (!item) return next(new AppError('Item not found', 404));

    const descendantIds = await getDescendantIds(item._id);
    const allIds = [item._id, ...descendantIds];

    const attachments = await Attachment.find({ projectItem: { $in: allIds } });
    for (const attachment of attachments) {
      try {
        await deleteFile(attachment.gridFsId);
      } catch {
        // best-effort: continue cleanup even if a blob is already gone
      }
    }
    await Attachment.deleteMany({ projectItem: { $in: allIds } });
    await Comment.deleteMany({ projectItem: { $in: allIds } });
    await ProjectItem.deleteMany({ _id: { $in: allIds } });

    if (item.parentId) await recomputeAncestorStatuses(item.parentId);

    res.status(200).json({ message: 'Item deleted' });
  } catch (err) {
    next(err);
  }
};

export const reorderItems = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));

    const { parentId, orderedIds } = req.body;

    const siblings = await ProjectItem.find({
      project: project._id,
      parentId: parentId ?? null,
    }).select('_id');
    const siblingIds = new Set(siblings.map((s) => String(s._id)));

    if (
      orderedIds.length !== siblingIds.size ||
      !orderedIds.every((id) => siblingIds.has(String(id)))
    ) {
      return next(new AppError('orderedIds must match exactly the siblings of this parent', 400));
    }

    await ProjectItem.bulkWrite(
      orderedIds.map((id, index) => ({
        updateOne: { filter: { _id: id }, update: { order: index } },
      }))
    );

    res.status(200).json({ message: 'Order updated' });
  } catch (err) {
    next(err);
  }
};
