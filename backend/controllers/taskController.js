import Task from '../models/Task.js';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';

const getTeamMemberIds = async (teamLeadId) => {
  const members = await User.find({ teamLeadId, role: 'Employee' }).select('_id');
  return members.map((m) => m._id);
};

export const getTasks = async (req, res, next) => {
  try {
    let filter = { parentTask: null };

    if (req.user.role === 'Employee') {
      filter.assignedTo = req.user._id;
    } else if (req.user.role === 'Team Lead') {
      const memberIds = await getTeamMemberIds(req.user._id);
      filter.assignedTo = { $in: [req.user._id, ...memberIds] };
    }

    const tasks = await Task.find(filter)
      .populate('createdBy', 'username email role')
      .populate('assignedTo', 'username email role');

    res.status(200).json(tasks);
  } catch (err) {
    next(err);
  }
};

export const getTaskById = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('createdBy', 'username email role')
      .populate('assignedTo', 'username email role');

    if (!task) return next(new AppError('Task not found', 404));

    if (req.user.role === 'Employee') {
      const isOwn =
        String(task.assignedTo._id) === String(req.user._id) ||
        String(task.createdBy._id) === String(req.user._id);
      if (!isOwn) return next(new AppError('Access denied', 403));
    } else if (req.user.role === 'Team Lead') {
      const memberIds = await getTeamMemberIds(req.user._id);
      const allowed = [String(req.user._id), ...memberIds.map(String)];
      if (!allowed.includes(String(task.assignedTo._id)))
        return next(new AppError('Access denied', 403));
    }

    res.status(200).json(task);
  } catch (err) {
    next(err);
  }
};

export const createTask = async (req, res, next) => {
  try {
    const { title, description, assignedTo, parentTask } = req.body;

    let resolvedAssignee = req.user._id;

    if (req.user.role === 'Team Lead') {
      if (assignedTo && String(assignedTo) !== String(req.user._id)) {
        const memberIds = await getTeamMemberIds(req.user._id);
        const isTeamMember = memberIds.some((id) => String(id) === String(assignedTo));
        if (!isTeamMember)
          return next(new AppError('You can only assign tasks to your team members', 403));
        resolvedAssignee = assignedTo;
      } else {
        resolvedAssignee = assignedTo || req.user._id;
      }
    } else if (req.user.role === 'Manager') {
      if (assignedTo) {
        const userExists = await User.findById(assignedTo);
        if (!userExists) return next(new AppError('Assigned user not found', 404));
        resolvedAssignee = assignedTo;
      }
    }

    const task = await Task.create({
      title: title.trim(),
      description,
      createdBy: req.user._id,
      assignedTo: resolvedAssignee,
      parentTask: parentTask ?? null,
    });

    const populated = await task.populate([
      { path: 'createdBy', select: 'username email role' },
      { path: 'assignedTo', select: 'username email role' },
    ]);

    res.status(201).json({ message: 'Task created', task: populated });
  } catch (err) {
    next(err);
  }
};

export const updateTask = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return next(new AppError('Task not found', 404));

    const { title, description, status } = req.body;

    if (req.user.role === 'Employee') {
      const isOwn =
        String(task.assignedTo) === String(req.user._id) ||
        String(task.createdBy) === String(req.user._id);
      if (!isOwn) return next(new AppError('You can only update your own tasks', 403));
    } else if (req.user.role === 'Team Lead') {
      const memberIds = await getTeamMemberIds(req.user._id);
      const allowed = [String(req.user._id), ...memberIds.map(String)];
      if (!allowed.includes(String(task.assignedTo)))
        return next(new AppError('You can only update tasks of your team', 403));
    }

    if (title !== undefined) task.title = title.trim();
    if (description !== undefined) task.description = description;
    if (status !== undefined) task.status = status;

    await task.save();

    const populated = await task.populate([
      { path: 'createdBy', select: 'username email role' },
      { path: 'assignedTo', select: 'username email role' },
    ]);

    res.status(200).json({ message: 'Task updated', task: populated });
  } catch (err) {
    next(err);
  }
};

const roleRank = { Manager: 3, 'Team Lead': 2, Employee: 1 };

export const deleteTask = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).populate('createdBy', 'role');
    if (!task) return next(new AppError('Task not found', 404));

    const userId = String(req.user._id);
    const creatorId = String(task.createdBy._id ?? task.createdBy);
    const isCreator = userId === creatorId;
    const creatorRole = task.createdBy.role;
    const callerRank = roleRank[req.user.role] ?? 0;
    const creatorRank = roleRank[creatorRole] ?? 0;

    // Allow if: creator, or caller has a strictly higher role rank
    if (!isCreator && callerRank <= creatorRank) {
      return next(new AppError('Access denied', 403));
    }

    await Task.deleteMany({ parentTask: req.params.id });
    await Task.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Task deleted' });
  } catch (err) {
    next(err);
  }
};

export const getSubtasks = async (req, res, next) => {
  try {
    const subtasks = await Task.find({ parentTask: req.params.id })
      .populate('createdBy', 'username email role')
      .populate('assignedTo', 'username email role');
    res.status(200).json(subtasks);
  } catch (err) {
    next(err);
  }
};

export const reassignTask = async (req, res, next) => {
  try {
    const { assignedTo } = req.body;

    const userExists = await User.findById(assignedTo);
    if (!userExists) return next(new AppError('User not found', 404));

    const task = await Task.findByIdAndUpdate(
      req.params.id,
      { assignedTo },
      { new: true }
    ).populate([
      { path: 'createdBy', select: 'username email role' },
      { path: 'assignedTo', select: 'username email role' },
    ]);

    if (!task) return next(new AppError('Task not found', 404));

    res.status(200).json({ message: 'Task reassigned', task });
  } catch (err) {
    next(err);
  }
};
