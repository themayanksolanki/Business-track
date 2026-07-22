import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { getAccessibleDepartmentIds, getTeamMemberIds } from '../utils/access.js';

interface DashboardResult {
  tasks: { todo: number; pending: number; completed: number; total: number; overdue: number };
  projects: { active: number; completed: number; archived: number; draft: number; total: number };
  recentProjects: unknown[];
  departmentBreakdown?: unknown[];
  teamBreakdown?: unknown[];
}

// Single aggregate endpoint for the dashboard's widgets — scoping mirrors
// getTasks (taskController.js) and getProjects (projectController.js) so a
// user only ever sees counts for the same rows those list endpoints would
// return them, just pre-aggregated instead of paginated.
export const getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const now = new Date();

    const taskWhere: Prisma.TaskWhereInput = { parentTaskId: null, organizationId: user.organizationId };
    if (user.role === 'User') {
      taskWhere.assignedToId = user.id;
    } else if (user.role === 'Team Lead') {
      const memberIds = await getTeamMemberIds(user.id);
      taskWhere.assignedToId = { in: [user.id, ...memberIds] };
    }

    const [taskStatusCounts, overdueCount] = await Promise.all([
      prisma.task.groupBy({ by: ['status'], where: taskWhere, _count: { _all: true } }),
      prisma.task.count({ where: { ...taskWhere, dueDate: { lt: now }, status: { not: 'completed' } } }),
    ]);

    const tasks = { todo: 0, pending: 0, completed: 0, total: 0, overdue: overdueCount };
    for (const { status, _count } of taskStatusCounts) {
      tasks[status] = _count._all;
      tasks.total += _count._all;
    }

    const projectWhere: Prisma.ProjectWhereInput = { organizationId: user.organizationId };
    if (user.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(user);
      projectWhere.OR = [
        { departmentId: { in: accessibleIds ?? [] } },
        { departmentId: null, createdById: user.id },
        { departmentId: null, ownerId: user.id },
        { members: { some: { userId: user.id } } },
      ];
    }

    const projectStatusCounts = await prisma.project.groupBy({
      by: ['status'],
      where: projectWhere,
      _count: { _all: true },
    });

    const projects = { active: 0, completed: 0, archived: 0, draft: 0, total: 0 };
    for (const { status, _count } of projectStatusCounts) {
      projects[status] = _count._all;
      projects.total += _count._all;
    }

    const recentProjectRows = await prisma.project.findMany({
      where: { ...projectWhere, status: { not: 'draft' } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        status: true,
        priority: true,
        department: { select: { id: true, name: true, color: true } },
        items: { select: { status: true, type: true } },
      },
    });

    // Progress is leaf-item completion (groups are just containers, not
    // completable work) — same denominator a project's own item tree uses.
    const recentProjects = recentProjectRows.map(({ items, ...p }) => {
      const leafItems = items.filter((i) => i.type !== 'group');
      const itemsCompleted = leafItems.filter((i) => i.status === 'completed').length;
      const itemsTotal = leafItems.length;
      return {
        ...p,
        itemsTotal,
        itemsCompleted,
        progress: itemsTotal ? Math.round((itemsCompleted / itemsTotal) * 100) : 0,
      };
    });

    const result: DashboardResult = { tasks, projects, recentProjects };

    if (user.role === 'Admin' || user.role === 'Manager') {
      const departmentWhere: Prisma.DepartmentWhereInput = { organizationId: user.organizationId };
      if (user.role === 'Manager') {
        departmentWhere.id = { in: (await getAccessibleDepartmentIds(user)) ?? [] };
      }

      const departments = await prisma.department.findMany({
        where: departmentWhere,
        select: { id: true, name: true, color: true },
        orderBy: { order: 'asc' },
      });

      const deptProjectCounts = await prisma.project.groupBy({
        by: ['departmentId', 'status'],
        where: { organizationId: user.organizationId, departmentId: { in: departments.map((d) => d.id) } },
        _count: { _all: true },
      });

      result.departmentBreakdown = departments.map((d) => {
        const rows = deptProjectCounts.filter((r) => r.departmentId === d.id);
        return {
          ...d,
          totalProjects: rows.reduce((sum, r) => sum + r._count._all, 0),
          activeProjects: rows.find((r) => r.status === 'active')?._count._all ?? 0,
          completedProjects: rows.find((r) => r.status === 'completed')?._count._all ?? 0,
        };
      });
    }

    if (user.role === 'Team Lead') {
      const memberIds = await getTeamMemberIds(user.id);

      const [members, memberTaskCounts] = await Promise.all([
        prisma.user.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, username: true, profileImage: true },
        }),
        prisma.task.groupBy({
          by: ['assignedToId', 'status'],
          where: { organizationId: user.organizationId, assignedToId: { in: memberIds }, parentTaskId: null },
          _count: { _all: true },
        }),
      ]);

      result.teamBreakdown = members.map((m) => {
        const rows = memberTaskCounts.filter((r) => r.assignedToId === m.id);
        const todo = rows.find((r) => r.status === 'todo')?._count._all ?? 0;
        const pending = rows.find((r) => r.status === 'pending')?._count._all ?? 0;
        const completed = rows.find((r) => r.status === 'completed')?._count._all ?? 0;
        return { ...m, todo, pending, completed, total: todo + pending + completed };
      });
    }

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};
