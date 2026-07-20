import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { destroyBlob } from '../utils/blobStorage.js';
import { MAX_DEPTH, typeForDepth, recomputeAncestorStatuses } from '../services/statusSync.service.js';
import { canAccessProject } from './projectController.js';
import { nextSequenceId } from '../utils/sequence.js';

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };
const ACCESS_INCLUDE = { members: { select: { userId: true } } };
const ITEM_INCLUDE = {
  assignedTo: { select: USER_SELECT },
  createdBy: { select: USER_SELECT },
  updatedBy: { select: USER_SELECT },
  tags: { select: { id: true, name: true, textColor: true, backgroundColor: true } },
};

const getDescendantIds = async (rootId) => {
  const result = [];
  let frontier = [rootId];
  while (frontier.length) {
    const children = await prisma.projectItem.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    const ids = children.map((c) => c.id);
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
    const children = await prisma.projectItem.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true, depth: true },
    });
    if (children.length === 0) break;
    maxDepth = Math.max(maxDepth, ...children.map((c) => c.depth));
    frontier = children.map((c) => c.id);
  }
  return maxDepth;
};

// Indent/outdent only ever change the moved item's own depth by exactly one
// level, so every descendant shifts by that same delta — walk the subtree
// and apply it, updating type (group/task/subtask) to match the new depth.
const shiftDescendantDepths = async (rootId, delta) => {
  let frontier = [rootId];
  while (frontier.length) {
    const children = await prisma.projectItem.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true, depth: true },
    });
    if (children.length === 0) break;
    await prisma.$transaction(
      children.map((c) =>
        prisma.projectItem.update({
          where: { id: c.id },
          data: { depth: c.depth + delta, type: typeForDepth(c.depth + delta) },
        })
      )
    );
    frontier = children.map((c) => c.id);
  }
};

// Recursively copies an item and its descendants under a new parent. Only
// structural fields (type/depth/order) and the title carry over — everything
// else (assignee, dates, tags, description, attachments, comments) is left
// at its schema default, since a duplicate is meant to be a clean copy of
// just the outline, not the whole item. Only the root of the copied subtree
// gets the " copy" suffix; nested items keep their original title verbatim.
const duplicateSubtree = async (tx, source, projectId, organizationId, parentId, order, createdById, isRoot) => {
  const sequenceId = await nextSequenceId(tx, organizationId, 'projectItem');
  const created = await tx.projectItem.create({
    data: {
      projectId,
      organizationId,
      sequenceId,
      parentId,
      type: source.type,
      title: isRoot ? `${source.title} copy` : source.title,
      depth: source.depth,
      order,
      createdById,
    },
  });

  const children = await tx.projectItem.findMany({
    where: { parentId: source.id },
    orderBy: { order: 'asc' },
  });
  for (let i = 0; i < children.length; i++) {
    await duplicateSubtree(tx, children[i], projectId, organizationId, created.id, i, createdById, false);
  }

  return created;
};

export const getItems = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const { limit } = req.query;

    if (limit) {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 12));
      const skip = (page - 1) * parsedLimit;

      const [items, total] = await Promise.all([
        prisma.projectItem.findMany({
          where: { projectId: project.id },
          include: ITEM_INCLUDE,
          orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { order: 'asc' }],
          skip,
          take: parsedLimit,
        }),
        prisma.projectItem.count({ where: { projectId: project.id } }),
      ]);

      return res.status(200).json({
        items,
        total,
        page,
        limit: parsedLimit,
        totalPages: Math.max(1, Math.ceil(total / parsedLimit)),
      });
    }

    const items = await prisma.projectItem.findMany({
      where: { projectId: project.id },
      include: ITEM_INCLUDE,
      orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { order: 'asc' }],
    });

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
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const items = await prisma.projectItem.findMany({
      where: { projectId: project.id },
      select: { id: true },
    });
    const itemIds = items.map((i) => i.id);

    const [commentCounts, imageAttachments] = await Promise.all([
      prisma.comment.groupBy({
        by: ['projectItemId'],
        where: { projectItemId: { in: itemIds } },
        _count: { _all: true },
      }),
      prisma.attachment.findMany({
        where: { projectItemId: { in: itemIds }, mimeType: { startsWith: 'image/' } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, projectItemId: true, fileName: true, mimeType: true },
      }),
    ]);

    const summary = {};
    for (const { projectItemId, _count } of commentCounts) {
      summary[projectItemId] = { commentCount: _count._all, cover: null };
    }
    for (const a of imageAttachments) {
      const key = a.projectItemId;
      if (!summary[key]) summary[key] = { commentCount: 0, cover: null };
      if (!summary[key].cover)
        summary[key].cover = { attachmentId: a.id, fileName: a.fileName, mimeType: a.mimeType };
    }

    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
};

export const createItem = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: { members: { select: { userId: true } } },
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const { title, description, priority, assignedTo, parentId, startDate, endDate, tags } = req.body;
    const assignedToNum = assignedTo ? Number(assignedTo) : null;
    const parentIdNum = parentId ? Number(parentId) : null;

    if (assignedToNum && !project.members.some((m) => m.userId === assignedToNum))
      return next(new AppError('assignedTo must be a project member', 400));

    let depth = 0;
    let parent = null;

    if (parentIdNum) {
      parent = await prisma.projectItem.findUnique({ where: { id: parentIdNum } });
      if (!parent || parent.projectId !== project.id)
        return next(new AppError('Parent item not found in this project', 404));

      if (parent.depth >= MAX_DEPTH)
        return next(new AppError(`Maximum hierarchy depth of ${MAX_DEPTH + 1} levels reached`, 400));

      depth = parent.depth + 1;
    }

    const order = await prisma.projectItem.count({ where: { projectId: project.id, parentId: parentIdNum } });

    const item = await prisma.$transaction(async (tx) => {
      const sequenceId = await nextSequenceId(tx, project.organizationId, 'projectItem');
      return tx.projectItem.create({
        data: {
          projectId: project.id,
          organizationId: project.organizationId,
          sequenceId,
          parentId: parentIdNum,
          type: typeForDepth(depth),
          title: title.trim(),
          description: description ?? '',
          priority: priority ?? 'medium',
          assignedToId: depth === 0 ? null : assignedToNum,
          createdById: req.user.id,
          depth,
          order,
          startDate: startDate ?? null,
          endDate: endDate ?? null,
          tags: { connect: (tags ?? []).map((id) => ({ id: Number(id) })) },
        },
        include: ITEM_INCLUDE,
      });
    });

    if (parent) await recomputeAncestorStatuses(parent.id);

    res.status(201).json({ message: 'Item created', item });
  } catch (err) {
    next(err);
  }
};

export const getItemById = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await prisma.projectItem.findFirst({
      where: { id: Number(req.params.itemId), projectId: project.id },
      include: ITEM_INCLUDE,
    });
    if (!item) return next(new AppError('Item not found', 404));

    res.status(200).json(item);
  } catch (err) {
    next(err);
  }
};

export const updateItem = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: { members: { select: { userId: true } } },
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await prisma.projectItem.findFirst({
      where: { id: Number(req.params.itemId), projectId: project.id },
    });
    if (!item) return next(new AppError('Item not found', 404));

    const { title, description, priority, assignedTo, status, startDate, endDate, tags } = req.body;
    const data = { updatedById: req.user.id };

    if (project.status === 'draft' && (startDate !== undefined || endDate !== undefined))
      return next(new AppError('Item dates are locked until the draft is approved', 400));

    if (status !== undefined) {
      if (item.type === 'group') return next(new AppError('Groups do not have a status', 400));
      if (project.status === 'draft' && status !== 'todo')
        return next(new AppError("Items in a draft can only be 'todo' until the draft is approved", 400));
      const childCount = await prisma.projectItem.count({ where: { parentId: item.id } });
      if (childCount > 0)
        return next(new AppError('Status is derived from children and cannot be set directly', 400));
      data.status = status;
    }

    if (assignedTo !== undefined && item.type === 'group')
      return next(new AppError('Groups cannot be assigned', 400));

    const assignedToNum = assignedTo ? Number(assignedTo) : null;
    if (assignedToNum && !project.members.some((m) => m.userId === assignedToNum))
      return next(new AppError('assignedTo must be a project member', 400));

    if (title !== undefined) data.title = title.trim();
    if (description !== undefined) data.description = description;
    if (priority !== undefined) data.priority = priority;
    if (assignedTo !== undefined) data.assignedToId = assignedToNum;
    if (startDate !== undefined) data.startDate = startDate || null;
    if (endDate !== undefined) data.endDate = endDate || null;
    if (tags !== undefined) data.tags = { set: tags.map((id) => ({ id: Number(id) })) };

    const updated = await prisma.projectItem.update({
      where: { id: item.id },
      data,
      include: ITEM_INCLUDE,
    });

    if (status !== undefined) await recomputeAncestorStatuses(item.parentId);

    res.status(200).json({ message: 'Item updated', item: updated });
  } catch (err) {
    next(err);
  }
};

export const deleteItem = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await prisma.projectItem.findFirst({
      where: { id: Number(req.params.itemId), projectId: project.id },
    });
    if (!item) return next(new AppError('Item not found', 404));

    const descendantIds = await getDescendantIds(item.id);
    const allIds = [item.id, ...descendantIds];

    const attachments = await prisma.attachment.findMany({
      where: { projectItemId: { in: allIds } },
      select: { publicId: true, storage: true },
    });
    // blob deletions are independent I/O, run concurrently; destroyBlob is
    // already best-effort internally
    await Promise.allSettled(attachments.map((a) => destroyBlob(a)));

    // Comments and Attachments cascade-delete at the DB level once their
    // ProjectItem is gone (see schema.prisma).
    await prisma.projectItem.deleteMany({ where: { id: { in: allIds } } });

    if (item.parentId) await recomputeAncestorStatuses(item.parentId);

    res.status(200).json({ message: 'Item deleted' });
  } catch (err) {
    next(err);
  }
};

export const duplicateItem = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await prisma.projectItem.findFirst({
      where: { id: Number(req.params.itemId), projectId: project.id },
    });
    if (!item) return next(new AppError('Item not found', 404));

    // make room right after the original among its siblings
    const laterSiblings = await prisma.projectItem.findMany({
      where: { projectId: project.id, parentId: item.parentId, order: { gt: item.order } },
    });

    const duplicate = await prisma.$transaction(async (tx) => {
      if (laterSiblings.length) {
        await Promise.all(
          laterSiblings.map((s) => tx.projectItem.update({ where: { id: s.id }, data: { order: s.order + 1 } }))
        );
      }

      return duplicateSubtree(
        tx,
        item,
        project.id,
        project.organizationId,
        item.parentId,
        item.order + 1,
        req.user.id,
        true
      );
    });

    if (item.parentId) await recomputeAncestorStatuses(item.parentId);

    const full = await prisma.projectItem.findUnique({ where: { id: duplicate.id }, include: ITEM_INCLUDE });
    res.status(201).json({ message: 'Item duplicated', item: full });
  } catch (err) {
    next(err);
  }
};

export const moveItem = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await prisma.projectItem.findFirst({
      where: { id: Number(req.params.itemId), projectId: project.id },
    });
    if (!item) return next(new AppError('Item not found', 404));

    const { direction } = req.body;
    const oldParentId = item.parentId;

    if (direction === 'up' || direction === 'down') {
      const siblings = await prisma.projectItem.findMany({
        where: { projectId: project.id, parentId: oldParentId },
        orderBy: { order: 'asc' },
      });
      const index = siblings.findIndex((s) => s.id === item.id);
      const swapWith = direction === 'up' ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= siblings.length)
        return next(
          new AppError(`Item is already at the ${direction === 'up' ? 'top' : 'bottom'}`, 400)
        );

      const other = siblings[swapWith];
      await prisma.$transaction([
        prisma.projectItem.update({
          where: { id: item.id },
          data: { order: other.order, updatedById: req.user.id },
        }),
        prisma.projectItem.update({ where: { id: other.id }, data: { order: item.order } }),
      ]);
    } else if (direction === 'indent') {
      const siblings = await prisma.projectItem.findMany({
        where: { projectId: project.id, parentId: oldParentId },
        orderBy: { order: 'asc' },
      });
      const index = siblings.findIndex((s) => s.id === item.id);
      if (index === 0)
        return next(new AppError('Cannot indent the first item under its parent', 400));

      const newParent = siblings[index - 1];
      const newDepth = newParent.depth + 1;
      const subtreeMaxDepth = await getMaxDescendantDepth(item.id, item.depth);
      const depthDelta = newDepth - item.depth;
      if (subtreeMaxDepth + depthDelta > MAX_DEPTH)
        return next(new AppError(`Maximum hierarchy depth of ${MAX_DEPTH + 1} levels reached`, 400));

      // close the gap left behind among the old siblings
      const toClose = siblings.slice(index + 1);
      if (toClose.length)
        await prisma.$transaction(
          toClose.map((s, i) => prisma.projectItem.update({ where: { id: s.id }, data: { order: index + i } }))
        );

      const newSiblingCount = await prisma.projectItem.count({
        where: { projectId: project.id, parentId: newParent.id },
      });

      await prisma.projectItem.update({
        where: { id: item.id },
        data: {
          parentId: newParent.id,
          order: newSiblingCount,
          depth: newDepth,
          type: typeForDepth(newDepth),
          updatedById: req.user.id,
        },
      });

      if (depthDelta !== 0) await shiftDescendantDepths(item.id, depthDelta);

      await recomputeAncestorStatuses(newParent.id);
      if (oldParentId) await recomputeAncestorStatuses(oldParentId);
    } else if (direction === 'outdent') {
      if (!oldParentId) return next(new AppError('Item is already at the top level', 400));

      const oldParent = await prisma.projectItem.findUnique({ where: { id: oldParentId } });
      if (!oldParent) return next(new AppError('Parent item not found', 404));

      if (oldParent.depth === 0)
        return next(new AppError('Cannot outdent an item directly under a group', 400));

      const newParentId = oldParent.parentId ?? null;

      // close the gap left behind among the old siblings
      const oldSiblings = await prisma.projectItem.findMany({
        where: { projectId: project.id, parentId: oldParentId, id: { not: item.id } },
        orderBy: { order: 'asc' },
      });
      if (oldSiblings.length)
        await prisma.$transaction(
          oldSiblings.map((s, i) => prisma.projectItem.update({ where: { id: s.id }, data: { order: i } }))
        );

      // make room right after the old parent among the new siblings
      const newSiblings = await prisma.projectItem.findMany({
        where: { projectId: project.id, parentId: newParentId },
        orderBy: { order: 'asc' },
      });
      const insertAt = oldParent.order + 1;
      const toShift = newSiblings.filter((s) => s.order >= insertAt);
      if (toShift.length)
        await prisma.$transaction(
          toShift.map((s) => prisma.projectItem.update({ where: { id: s.id }, data: { order: s.order + 1 } }))
        );

      const depthDelta = oldParent.depth - item.depth;
      await prisma.projectItem.update({
        where: { id: item.id },
        data: {
          parentId: newParentId,
          order: insertAt,
          depth: oldParent.depth,
          type: typeForDepth(oldParent.depth),
          updatedById: req.user.id,
        },
      });

      if (depthDelta !== 0) await shiftDescendantDepths(item.id, depthDelta);

      await recomputeAncestorStatuses(oldParentId);
      if (newParentId) await recomputeAncestorStatuses(newParentId);
    }

    const updated = await prisma.projectItem.findUnique({ where: { id: item.id }, include: ITEM_INCLUDE });
    res.status(200).json({ message: 'Item moved', item: updated });
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
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await prisma.projectItem.findFirst({
      where: { id: Number(req.params.itemId), projectId: project.id },
    });
    if (!item) return next(new AppError('Item not found', 404));

    const { parentId, index } = req.body;
    const oldParentId = item.parentId;
    const newParentId = parentId ? Number(parentId) : null;

    if (newParentId && newParentId === item.id)
      return next(new AppError('An item cannot be its own parent', 400));

    let newParent = null;
    let newDepth = 0;
    if (newParentId) {
      newParent = await prisma.projectItem.findFirst({ where: { id: newParentId, projectId: project.id } });
      if (!newParent) return next(new AppError('Parent item not found in this project', 404));
      newDepth = newParent.depth + 1;

      const descendantIds = await getDescendantIds(item.id);
      if (descendantIds.includes(newParentId))
        return next(new AppError('Cannot move an item into its own descendant', 400));
    }

    const subtreeMaxDepth = await getMaxDescendantDepth(item.id, item.depth);
    const depthDelta = newDepth - item.depth;
    if (subtreeMaxDepth + depthDelta > MAX_DEPTH)
      return next(new AppError(`Maximum hierarchy depth of ${MAX_DEPTH + 1} levels reached`, 400));

    const sameParent = oldParentId === newParentId;

    // close the gap left behind among the old siblings
    if (!sameParent) {
      const oldSiblings = await prisma.projectItem.findMany({
        where: { projectId: project.id, parentId: oldParentId, id: { not: item.id } },
        orderBy: { order: 'asc' },
      });
      if (oldSiblings.length)
        await prisma.$transaction(
          oldSiblings.map((s, i) => prisma.projectItem.update({ where: { id: s.id }, data: { order: i } }))
        );
    }

    // make room at the requested position among the new siblings
    const newSiblings = await prisma.projectItem.findMany({
      where: { projectId: project.id, parentId: newParentId, id: { not: item.id } },
      orderBy: { order: 'asc' },
    });
    const insertAt = Math.max(0, Math.min(index ?? newSiblings.length, newSiblings.length));
    const toShift = newSiblings.filter((s) => s.order >= insertAt);
    if (toShift.length)
      await prisma.$transaction(
        toShift.map((s) => prisma.projectItem.update({ where: { id: s.id }, data: { order: s.order + 1 } }))
      );

    const data = {
      parentId: newParentId,
      order: insertAt,
      depth: newDepth,
      type: typeForDepth(newDepth),
      updatedById: req.user.id,
    };
    if (newDepth === 0) data.assignedToId = null;
    await prisma.projectItem.update({ where: { id: item.id }, data });

    if (depthDelta !== 0) await shiftDescendantDepths(item.id, depthDelta);

    if (oldParentId) await recomputeAncestorStatuses(oldParentId);
    if (newParentId) await recomputeAncestorStatuses(newParentId);

    const updated = await prisma.projectItem.findUnique({ where: { id: item.id }, include: ITEM_INCLUDE });
    res.status(200).json({ message: 'Item moved', item: updated });
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
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const { itemIds, parentId } = req.body;
    const parentIdNum = Number(parentId);

    const newParent = await prisma.projectItem.findFirst({ where: { id: parentIdNum, projectId: project.id } });
    if (!newParent) return next(new AppError('Target group not found in this project', 404));

    const newDepth = newParent.depth + 1;

    const items = await prisma.projectItem.findMany({
      where: { id: { in: itemIds.map(Number) }, projectId: project.id },
    });

    let movedCount = 0;
    let alreadyInGroupCount = 0;
    const affectedParentIds = new Set();

    for (const item of items) {
      const oldParentId = item.parentId;

      if (oldParentId === newParent.id) {
        alreadyInGroupCount += 1;
        continue;
      }

      if (item.id === newParent.id) continue;

      const descendantIds = await getDescendantIds(item.id);
      if (descendantIds.includes(newParent.id)) continue;

      const subtreeMaxDepth = await getMaxDescendantDepth(item.id, item.depth);
      const depthDelta = newDepth - item.depth;
      if (subtreeMaxDepth + depthDelta > MAX_DEPTH) continue;

      // close the gap left behind among the old siblings
      const oldSiblings = await prisma.projectItem.findMany({
        where: { projectId: project.id, parentId: oldParentId, id: { not: item.id } },
        orderBy: { order: 'asc' },
      });
      if (oldSiblings.length)
        await prisma.$transaction(
          oldSiblings.map((s, i) => prisma.projectItem.update({ where: { id: s.id }, data: { order: i } }))
        );

      // append to the end of the destination group's children
      const newSiblingCount = await prisma.projectItem.count({
        where: { projectId: project.id, parentId: newParent.id },
      });

      const data = {
        parentId: newParent.id,
        order: newSiblingCount,
        depth: newDepth,
        type: typeForDepth(newDepth),
        updatedById: req.user.id,
      };
      if (newDepth === 0) data.assignedToId = null;
      await prisma.projectItem.update({ where: { id: item.id }, data });

      if (depthDelta !== 0) await shiftDescendantDepths(item.id, depthDelta);

      if (oldParentId) affectedParentIds.add(oldParentId);
      affectedParentIds.add(newParent.id);
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
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const { parentId, orderedIds } = req.body;
    const parentIdNum = parentId ? Number(parentId) : null;

    const siblings = await prisma.projectItem.findMany({
      where: { projectId: project.id, parentId: parentIdNum },
      select: { id: true },
    });
    const siblingIds = new Set(siblings.map((s) => s.id));
    const numericOrderedIds = orderedIds.map(Number);

    if (
      numericOrderedIds.length !== siblingIds.size ||
      !numericOrderedIds.every((id) => siblingIds.has(id))
    ) {
      return next(new AppError('orderedIds must match exactly the siblings of this parent', 400));
    }

    await prisma.$transaction(
      numericOrderedIds.map((id, index) => prisma.projectItem.update({ where: { id }, data: { order: index } }))
    );

    res.status(200).json({ message: 'Order updated' });
  } catch (err) {
    next(err);
  }
};
