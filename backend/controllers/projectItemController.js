import ProjectItem from '../models/ProjectItem.js';
import Project from '../models/Project.js';
import Comment from '../models/Comment.js';
import Attachment from '../models/Attachment.js';
import AppError from '../utils/AppError.js';
import { deleteFile } from '../utils/gridfs.js';
import { MAX_DEPTH, typeForDepth, recomputeAncestorStatuses } from '../services/statusSync.service.js';
import { canAccessProject } from './projectController.js';

const POPULATE_FIELDS = [
  { path: 'assignedTo', select: 'username email role profileImage' },
  { path: 'createdBy', select: 'username email role profileImage' },
  { path: 'updatedBy', select: 'username email role profileImage' },
  { path: 'tags', select: 'name textColor backgroundColor' },
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

// Deepest depth reached anywhere in rootId's subtree (rootId's own depth included) —
// used to check indenting won't push a descendant past MAX_DEPTH.
const getMaxDescendantDepth = async (rootId, rootDepth) => {
  let maxDepth = rootDepth;
  let frontier = [rootId];
  while (frontier.length) {
    const children = await ProjectItem.find({ parentId: { $in: frontier } }).select('_id depth');
    if (children.length === 0) break;
    maxDepth = Math.max(maxDepth, ...children.map((c) => c.depth));
    frontier = children.map((c) => c._id);
  }
  return maxDepth;
};

// Indent/outdent only ever change the moved item's own depth by exactly one
// level, so every descendant shifts by that same delta — walk the subtree
// and apply it, updating type (group/task/subtask) to match the new depth.
const shiftDescendantDepths = async (rootId, delta) => {
  let frontier = [rootId];
  while (frontier.length) {
    const children = await ProjectItem.find({ parentId: { $in: frontier } }).select('_id depth');
    if (children.length === 0) break;
    await ProjectItem.bulkWrite(
      children.map((c) => ({
        updateOne: {
          filter: { _id: c._id },
          update: { depth: c.depth + delta, type: typeForDepth(c.depth + delta) },
        },
      }))
    );
    frontier = children.map((c) => c._id);
  }
};

export const getItems = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const { limit } = req.query;

    if (limit) {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 12));
      const skip = (page - 1) * parsedLimit;

      const [items, total] = await Promise.all([
        ProjectItem.find({ project: project._id })
          .populate(POPULATE_FIELDS)
          .sort({ parentId: 1, order: 1 })
          .skip(skip)
          .limit(parsedLimit),
        ProjectItem.countDocuments({ project: project._id }),
      ]);

      return res.status(200).json({
        items,
        total,
        page,
        limit: parsedLimit,
        totalPages: Math.max(1, Math.ceil(total / parsedLimit)),
      });
    }

    const items = await ProjectItem.find({ project: project._id })
      .populate(POPULATE_FIELDS)
      .sort({ parentId: 1, order: 1 });

    res.status(200).json(items);
  } catch (err) {
    next(err);
  }
};

// Lightweight per-item meta for card views (Kanban): first image attachment
// (as a cover) and comment count, batched in two queries instead of N+1
// round trips per card.
export const getItemsSummary = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const items = await ProjectItem.find({ project: project._id }).select('_id');
    const itemIds = items.map((i) => i._id);

    const [commentCounts, imageAttachments] = await Promise.all([
      Comment.aggregate([
        { $match: { projectItem: { $in: itemIds } } },
        { $group: { _id: '$projectItem', count: { $sum: 1 } } },
      ]),
      Attachment.find({ projectItem: { $in: itemIds }, mimeType: { $regex: '^image/' } })
        .sort({ createdAt: 1 })
        .select('projectItem fileName mimeType'),
    ]);

    const summary = {};
    for (const { _id, count } of commentCounts) {
      summary[String(_id)] = { commentCount: count, cover: null };
    }
    for (const a of imageAttachments) {
      const key = String(a.projectItem);
      if (!summary[key]) summary[key] = { commentCount: 0, cover: null };
      if (!summary[key].cover)
        summary[key].cover = { attachmentId: a._id, fileName: a.fileName, mimeType: a.mimeType };
    }

    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
};

export const createItem = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const { title, description, priority, assignedTo, parentId, startDate, endDate, tags } = req.body;

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
      assignedTo: depth === 0 ? null : assignedTo ?? null,
      createdBy: req.user._id,
      depth,
      order,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      tags: tags ?? [],
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
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

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
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await ProjectItem.findOne({ _id: req.params.itemId, project: req.params.projectId });
    if (!item) return next(new AppError('Item not found', 404));

    const { title, description, priority, assignedTo, status, startDate, endDate, tags } = req.body;

    if (status !== undefined) {
      if (item.type === 'group')
        return next(new AppError('Groups do not have a status', 400));
      const childCount = await ProjectItem.countDocuments({ parentId: item._id });
      if (childCount > 0)
        return next(new AppError('Status is derived from children and cannot be set directly', 400));
      item.status = status;
    }

    if (assignedTo !== undefined && item.type === 'group')
      return next(new AppError('Groups cannot be assigned', 400));

    if (title !== undefined) item.title = title.trim();
    if (description !== undefined) item.description = description;
    if (priority !== undefined) item.priority = priority;
    if (assignedTo !== undefined) item.assignedTo = assignedTo || null;
    if (startDate !== undefined) item.startDate = startDate || null;
    if (endDate !== undefined) item.endDate = endDate || null;
    if (tags !== undefined) item.tags = tags;
    item.updatedBy = req.user._id;

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
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await ProjectItem.findOne({ _id: req.params.itemId, project: req.params.projectId });
    if (!item) return next(new AppError('Item not found', 404));

    const descendantIds = await getDescendantIds(item._id);
    const allIds = [item._id, ...descendantIds];

    const attachments = await Attachment.find({ projectItem: { $in: allIds } });
    // best-effort: blob deletions are independent I/O, run concurrently and
    // continue cleanup even if some blobs are already gone
    await Promise.allSettled(attachments.map((a) => deleteFile(a.gridFsId)));
    await Attachment.deleteMany({ projectItem: { $in: allIds } });
    await Comment.deleteMany({ projectItem: { $in: allIds } });
    await ProjectItem.deleteMany({ _id: { $in: allIds } });

    if (item.parentId) await recomputeAncestorStatuses(item.parentId);

    res.status(200).json({ message: 'Item deleted' });
  } catch (err) {
    next(err);
  }
};

export const moveItem = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await ProjectItem.findOne({ _id: req.params.itemId, project: project._id });
    if (!item) return next(new AppError('Item not found', 404));

    const { direction } = req.body;
    const oldParentId = item.parentId;

    if (direction === 'up' || direction === 'down') {
      const siblings = await ProjectItem.find({ project: project._id, parentId: oldParentId }).sort({
        order: 1,
      });
      const index = siblings.findIndex((s) => String(s._id) === String(item._id));
      const swapWith = direction === 'up' ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= siblings.length)
        return next(
          new AppError(`Item is already at the ${direction === 'up' ? 'top' : 'bottom'}`, 400)
        );

      const other = siblings[swapWith];
      const itemOrder = item.order;
      item.order = other.order;
      other.order = itemOrder;
      item.updatedBy = req.user._id;
      await item.save();
      await other.save();
    } else if (direction === 'indent') {
      const siblings = await ProjectItem.find({ project: project._id, parentId: oldParentId }).sort({
        order: 1,
      });
      const index = siblings.findIndex((s) => String(s._id) === String(item._id));
      if (index === 0)
        return next(new AppError('Cannot indent the first item under its parent', 400));

      const newParent = siblings[index - 1];
      const newDepth = newParent.depth + 1;
      const subtreeMaxDepth = await getMaxDescendantDepth(item._id, item.depth);
      const depthDelta = newDepth - item.depth;
      if (subtreeMaxDepth + depthDelta > MAX_DEPTH)
        return next(new AppError(`Maximum hierarchy depth of ${MAX_DEPTH + 1} levels reached`, 400));

      // close the gap left behind among the old siblings
      await ProjectItem.bulkWrite(
        siblings.slice(index + 1).map((s, i) => ({
          updateOne: { filter: { _id: s._id }, update: { order: index + i } },
        }))
      );

      const newSiblingCount = await ProjectItem.countDocuments({
        project: project._id,
        parentId: newParent._id,
      });
      item.parentId = newParent._id;
      item.order = newSiblingCount;
      item.depth = newDepth;
      item.type = typeForDepth(newDepth);
      item.updatedBy = req.user._id;
      await item.save();

      if (depthDelta !== 0) await shiftDescendantDepths(item._id, depthDelta);

      await recomputeAncestorStatuses(newParent._id);
      if (oldParentId) await recomputeAncestorStatuses(oldParentId);
    } else if (direction === 'outdent') {
      if (!oldParentId) return next(new AppError('Item is already at the top level', 400));

      const oldParent = await ProjectItem.findById(oldParentId);
      if (!oldParent) return next(new AppError('Parent item not found', 404));

      if (oldParent.depth === 0)
        return next(new AppError('Cannot outdent an item directly under a group', 400));

      const newParentId = oldParent.parentId ?? null;

      // close the gap left behind among the old siblings
      const oldSiblings = await ProjectItem.find({
        project: project._id,
        parentId: oldParentId,
        _id: { $ne: item._id },
      }).sort({ order: 1 });
      await ProjectItem.bulkWrite(
        oldSiblings.map((s, i) => ({
          updateOne: { filter: { _id: s._id }, update: { order: i } },
        }))
      );

      // make room right after the old parent among the new siblings
      const newSiblings = await ProjectItem.find({ project: project._id, parentId: newParentId }).sort({
        order: 1,
      });
      const insertAt = oldParent.order + 1;
      await ProjectItem.bulkWrite(
        newSiblings
          .filter((s) => s.order >= insertAt)
          .map((s) => ({
            updateOne: { filter: { _id: s._id }, update: { order: s.order + 1 } },
          }))
      );

      const depthDelta = oldParent.depth - item.depth;
      item.parentId = newParentId;
      item.order = insertAt;
      item.depth = oldParent.depth;
      item.type = typeForDepth(oldParent.depth);
      item.updatedBy = req.user._id;
      await item.save();

      if (depthDelta !== 0) await shiftDescendantDepths(item._id, depthDelta);

      await recomputeAncestorStatuses(oldParentId);
      if (newParentId) await recomputeAncestorStatuses(newParentId);
    }

    const populated = await item.populate(POPULATE_FIELDS);
    res.status(200).json({ message: 'Item moved', item: populated });
  } catch (err) {
    next(err);
  }
};

// Drag-and-drop reparenting: moves an item to an arbitrary parent (or to the
// root when parentId is null) at a specific position among its new siblings —
// unlike indent/outdent, which only shift depth by one level relative to an
// adjacent sibling.
export const moveItemToParent = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await ProjectItem.findOne({ _id: req.params.itemId, project: project._id });
    if (!item) return next(new AppError('Item not found', 404));

    const { parentId, index } = req.body;
    const oldParentId = item.parentId ? String(item.parentId) : null;
    const newParentId = parentId ?? null;

    if (newParentId && newParentId === String(item._id))
      return next(new AppError('An item cannot be its own parent', 400));

    let newParent = null;
    let newDepth = 0;
    if (newParentId) {
      newParent = await ProjectItem.findOne({ _id: newParentId, project: project._id });
      if (!newParent) return next(new AppError('Parent item not found in this project', 404));
      newDepth = newParent.depth + 1;

      const descendantIds = await getDescendantIds(item._id);
      if (descendantIds.some((id) => String(id) === newParentId))
        return next(new AppError('Cannot move an item into its own descendant', 400));
    }

    const subtreeMaxDepth = await getMaxDescendantDepth(item._id, item.depth);
    const depthDelta = newDepth - item.depth;
    if (subtreeMaxDepth + depthDelta > MAX_DEPTH)
      return next(new AppError(`Maximum hierarchy depth of ${MAX_DEPTH + 1} levels reached`, 400));

    const sameParent = oldParentId === newParentId;

    // close the gap left behind among the old siblings
    if (!sameParent) {
      const oldSiblings = await ProjectItem.find({
        project: project._id,
        parentId: oldParentId,
        _id: { $ne: item._id },
      }).sort({ order: 1 });
      if (oldSiblings.length)
        await ProjectItem.bulkWrite(
          oldSiblings.map((s, i) => ({
            updateOne: { filter: { _id: s._id }, update: { order: i } },
          }))
        );
    }

    // make room at the requested position among the new siblings
    const newSiblings = await ProjectItem.find({
      project: project._id,
      parentId: newParentId,
      _id: { $ne: item._id },
    }).sort({ order: 1 });
    const insertAt = Math.max(0, Math.min(index ?? newSiblings.length, newSiblings.length));
    const toShift = newSiblings.filter((s) => s.order >= insertAt);
    if (toShift.length)
      await ProjectItem.bulkWrite(
        toShift.map((s) => ({
          updateOne: { filter: { _id: s._id }, update: { order: s.order + 1 } },
        }))
      );

    item.parentId = newParentId;
    item.order = insertAt;
    item.depth = newDepth;
    item.type = typeForDepth(newDepth);
    if (newDepth === 0) item.assignedTo = null;
    item.updatedBy = req.user._id;
    await item.save();

    if (depthDelta !== 0) await shiftDescendantDepths(item._id, depthDelta);

    if (oldParentId) await recomputeAncestorStatuses(oldParentId);
    if (newParentId) await recomputeAncestorStatuses(newParentId);

    const populated = await item.populate(POPULATE_FIELDS);
    res.status(200).json({ message: 'Item moved', item: populated });
  } catch (err) {
    next(err);
  }
};

// Bulk counterpart to moveItemToParent: moves several items to the same
// destination group in one request. Unlike the single-item version, an item
// already in the target group is treated as a no-op rather than an error —
// bulk selections routinely include tasks that are already where they need
// to be, and callers just want the rest to move.
export const bulkMoveItemsToParent = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const { itemIds, parentId } = req.body;

    const newParent = await ProjectItem.findOne({ _id: parentId, project: project._id });
    if (!newParent) return next(new AppError('Target group not found in this project', 404));

    const newParentId = String(newParent._id);
    const newDepth = newParent.depth + 1;

    const items = await ProjectItem.find({ _id: { $in: itemIds }, project: project._id });

    let movedCount = 0;
    let alreadyInGroupCount = 0;
    const affectedParentIds = new Set();

    for (const item of items) {
      const oldParentId = item.parentId ? String(item.parentId) : null;

      if (oldParentId === newParentId) {
        alreadyInGroupCount += 1;
        continue;
      }

      if (String(item._id) === newParentId) continue;

      const descendantIds = await getDescendantIds(item._id);
      if (descendantIds.some((id) => String(id) === newParentId)) continue;

      const subtreeMaxDepth = await getMaxDescendantDepth(item._id, item.depth);
      const depthDelta = newDepth - item.depth;
      if (subtreeMaxDepth + depthDelta > MAX_DEPTH) continue;

      // close the gap left behind among the old siblings
      const oldSiblings = await ProjectItem.find({
        project: project._id,
        parentId: oldParentId,
        _id: { $ne: item._id },
      }).sort({ order: 1 });
      if (oldSiblings.length)
        await ProjectItem.bulkWrite(
          oldSiblings.map((s, i) => ({
            updateOne: { filter: { _id: s._id }, update: { order: i } },
          }))
        );

      // append to the end of the destination group's children
      const newSiblingCount = await ProjectItem.countDocuments({
        project: project._id,
        parentId: newParentId,
      });

      item.parentId = newParentId;
      item.order = newSiblingCount;
      item.depth = newDepth;
      item.type = typeForDepth(newDepth);
      if (newDepth === 0) item.assignedTo = null;
      item.updatedBy = req.user._id;
      await item.save();

      if (depthDelta !== 0) await shiftDescendantDepths(item._id, depthDelta);

      if (oldParentId) affectedParentIds.add(oldParentId);
      affectedParentIds.add(newParentId);
      movedCount += 1;
    }

    for (const id of affectedParentIds) await recomputeAncestorStatuses(id);

    res.status(200).json({
      message: `${movedCount} item(s) moved`,
      movedCount,
      alreadyInGroupCount,
    });
  } catch (err) {
    next(err);
  }
};

export const reorderItems = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

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
