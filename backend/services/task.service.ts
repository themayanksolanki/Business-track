import type { Task } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { getTaskAccessLevel } from '../utils/access.js';

type AuthUser = { id: number; role: string; organizationId: number | null };

export const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };
export const TAG_SELECT = { id: true, name: true, textColor: true, backgroundColor: true };
export const TASK_INCLUDE = {
  createdBy: { select: USER_SELECT },
  updatedBy: { select: USER_SELECT },
  assignedTo: { select: USER_SELECT },
  tags: { select: TAG_SELECT },
};

// 404s (rather than 403ing) when the task belongs to another organization,
// so a cross-org task reads as "doesn't exist" instead of leaking that it
// exists behind an access check.
export async function loadOrgTask(taskId: number, user: AuthUser): Promise<Task> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.organizationId !== user.organizationId) throw new AppError('Task not found', 404);
  return task;
}

export async function loadOrgTaskWithRelations(taskId: number, user: AuthUser) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
  if (!task || task.organizationId !== user.organizationId) throw new AppError('Task not found', 404);
  return task;
}

// Task has no view-only tier yet (see getTaskAccessLevel's own comment) — this
// is the single predicate every task-mutating *and* task-reading endpoint
// should gate on, so a new endpoint can't accidentally skip it the way
// getSubtasks/reassignTask previously did.
export async function requireTaskEditAccess(
  task: { organizationId: number | null; assignedToId: number; createdById: number },
  user: AuthUser,
  message = 'Access denied'
) {
  if ((await getTaskAccessLevel(task, user)) !== 'edit') throw new AppError(message, 403);
}

export async function assertUserExists(id: number) {
  const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new AppError('User not found', 404);
}
