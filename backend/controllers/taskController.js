import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { ROLE_RANK } from '../utils/access.js';
import { nextSequenceId } from '../utils/sequence.js';

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };
const TAG_SELECT = { id: true, name: true, textColor: true, backgroundColor: true };
const TASK_INCLUDE = {
  createdBy: { select: USER_SELECT },
  updatedBy: { select: USER_SELECT },
  assignedTo: { select: USER_SELECT },
  tags: { select: TAG_SELECT },
};

const getTeamMemberIds = async (teamLeadId) => {
  const members = await prisma.user.findMany({ where: { teamLeadId, role: 'User' }, select: { id: true } });
  return members.map((m) => m.id);
};

export const getTasks = async (req, res, next) => {
  try {
    const where = { parentTaskId: null, organizationId: req.user.organizationId };

    if (req.user.role === 'User') {
      where.assignedToId = req.user.id;
    } else if (req.user.role === 'Team Lead') {
      const memberIds = await getTeamMemberIds(req.user.id);
      where.assignedToId = { in: [req.user.id, ...memberIds] };
    }

    const tasks = await prisma.task.findMany({ where, include: TASK_INCLUDE });

    res.status(200).json(tasks);
  } catch (err) {
    next(err);
  }
};

export const getTaskById = async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: Number(req.params.id) },
      include: TASK_INCLUDE,
    });

    if (!task || task.organizationId !== req.user.organizationId)
      return next(new AppError('Task not found', 404));

    if (req.user.role === 'User') {
      const isOwn = task.assignedToId === req.user.id || task.createdById === req.user.id;
      if (!isOwn) return next(new AppError('Access denied', 403));
    } else if (req.user.role === 'Team Lead') {
      const memberIds = await getTeamMemberIds(req.user.id);
      const allowed = [req.user.id, ...memberIds];
      if (!allowed.includes(task.assignedToId)) return next(new AppError('Access denied', 403));
    }

    res.status(200).json(task);
  } catch (err) {
    next(err);
  }
};

export const createTask = async (req, res, next) => {
  try {
    const { title, description, assignedTo, parentTask, tags } = req.body;
    const assignedToNum = assignedTo ? Number(assignedTo) : null;
    const parentTaskNum = parentTask ? Number(parentTask) : null;

    let resolvedAssignee = req.user.id;

    if (req.user.role === 'Team Lead') {
      if (assignedToNum && assignedToNum !== req.user.id) {
        const memberIds = await getTeamMemberIds(req.user.id);
        const isTeamMember = memberIds.includes(assignedToNum);
        if (!isTeamMember)
          return next(new AppError('You can only assign tasks to your team members', 403));
        resolvedAssignee = assignedToNum;
      } else {
        resolvedAssignee = assignedToNum || req.user.id;
      }
    } else if (req.user.role === 'Manager' || req.user.role === 'Admin') {
      if (assignedToNum) {
        const userExists = await prisma.user.findUnique({ where: { id: assignedToNum } });
        if (!userExists) return next(new AppError('Assigned user not found', 404));
        resolvedAssignee = assignedToNum;
      }
    }

    const task = await prisma.$transaction(async (tx) => {
      const sequenceId = await nextSequenceId(tx, req.user.organizationId, 'task');
      return tx.task.create({
        data: {
          title: title.trim(),
          description,
          createdById: req.user.id,
          assignedToId: resolvedAssignee,
          parentTaskId: parentTaskNum,
          organizationId: req.user.organizationId,
          sequenceId,
          tags: { connect: (tags ?? []).map((id) => ({ id: Number(id) })) },
        },
        include: TASK_INCLUDE,
      });
    });

    res.status(201).json({ message: 'Task created', task });
  } catch (err) {
    next(err);
  }
};

export const updateTask = async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    if (!task || task.organizationId !== req.user.organizationId)
      return next(new AppError('Task not found', 404));

    const { title, description, status, tags } = req.body;

    if (req.user.role === 'User') {
      const isOwn = task.assignedToId === req.user.id || task.createdById === req.user.id;
      if (!isOwn) return next(new AppError('You can only update your own tasks', 403));
    } else if (req.user.role === 'Team Lead') {
      const memberIds = await getTeamMemberIds(req.user.id);
      const allowed = [req.user.id, ...memberIds];
      if (!allowed.includes(task.assignedToId))
        return next(new AppError('You can only update tasks of your team', 403));
    }

    const data = { updatedById: req.user.id };
    if (title !== undefined) data.title = title.trim();
    if (description !== undefined) data.description = description;
    if (status !== undefined) data.status = status;
    if (tags !== undefined) data.tags = { set: tags.map((id) => ({ id: Number(id) })) };

    const updated = await prisma.task.update({ where: { id: task.id }, data, include: TASK_INCLUDE });

    res.status(200).json({ message: 'Task updated', task: updated });
  } catch (err) {
    next(err);
  }
};

export const deleteTask = async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: Number(req.params.id) },
      include: { createdBy: { select: { id: true, role: true } } },
    });
    if (!task || task.organizationId !== req.user.organizationId)
      return next(new AppError('Task not found', 404));

    const isCreator = req.user.id === task.createdBy.id;
    const callerRank = ROLE_RANK[req.user.role] ?? 0;
    const creatorRank = ROLE_RANK[task.createdBy.role] ?? 0;

    // Allow if: creator, or caller has a strictly higher role rank
    if (!isCreator && callerRank <= creatorRank) {
      return next(new AppError('Access denied', 403));
    }

    // Subtasks cascade-delete with their parent (see schema.prisma), but
    // deleteMany here matches the original's explicit two-step delete.
    await prisma.task.deleteMany({ where: { parentTaskId: task.id } });
    await prisma.task.delete({ where: { id: task.id } });
    res.status(200).json({ message: 'Task deleted' });
  } catch (err) {
    next(err);
  }
};

export const getSubtasks = async (req, res, next) => {
  try {
    const parent = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    if (!parent || parent.organizationId !== req.user.organizationId)
      return next(new AppError('Task not found', 404));

    const subtasks = await prisma.task.findMany({
      where: { parentTaskId: parent.id },
      include: TASK_INCLUDE,
    });
    res.status(200).json(subtasks);
  } catch (err) {
    next(err);
  }
};

export const reassignTask = async (req, res, next) => {
  try {
    const assignedToId = Number(req.body.assignedTo);

    const userExists = await prisma.user.findUnique({ where: { id: assignedToId } });
    if (!userExists) return next(new AppError('User not found', 404));

    const existingTask = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    if (!existingTask || existingTask.organizationId !== req.user.organizationId)
      return next(new AppError('Task not found', 404));

    const task = await prisma.task.update({
      where: { id: existingTask.id },
      data: { assignedToId, updatedById: req.user.id },
      include: TASK_INCLUDE,
    });

    res.status(200).json({ message: 'Task reassigned', task });
  } catch (err) {
    next(err);
  }
};
