import { Component, Input } from '@angular/core';
import { ProjectTreeNode, ProjectItemStatus, flattenTasks } from '../../models/project-item.model';
import { AuthService } from '../../core/services/auth.service';
import { User } from '../../models/user.model';

interface StatusCounts {
  todo: number;
  doing: number;
  completed: number;
  total: number;
}

interface WorkloadRow {
  user: User | null;
  count: number;
  percent: number;
  color: string;
}

const STATUS_COLORS: Record<ProjectItemStatus, string> = {
  todo: '#94a3b8',
  doing: '#3b82f6',
  completed: '#16a34a',
};

// Cycled per assignee row, in descending-count order — Unassigned (appended
// last regardless of its count, see `workload` below) always gets the fixed
// neutral tone instead of a palette slot.
const WORKLOAD_PALETTE = ['#16a34a', '#f59e0b', '#f97316', '#0ea5e9', '#8b5cf6', '#ec4899'];
const UNASSIGNED_COLOR = '#94a3b8';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Project-scoped status dashboard: 4 rolling-7-day stat tiles, a task-status
// donut, and a per-assignee workload breakdown — all computed client-side
// from the already-loaded item tree (no dedicated stats endpoint exists;
// every project-detail tab already gets the full tree via loadItems()).
@Component({
  selector: 'app-project-status',
  standalone: true,
  templateUrl: './project-status.component.html',
  styleUrl: './project-status.component.css',
})
export class ProjectStatusComponent {
  @Input({ required: true }) tree: ProjectTreeNode[] = [];

  private brokenAvatarIds = new Set<number>();

  constructor(public auth: AuthService) {}

  // Matches the Kanban board's definition of "a task" (flattenTasks) rather
  // than computeCompletionRollup's leaf-only one — a parent task with
  // subtasks is still its own assignable, trackable row here, same as it's
  // still its own card on the Kanban board.
  private get tasks(): ProjectTreeNode[] {
    return flattenTasks(this.tree);
  }

  // There's no separate "completed at" timestamp tracked anywhere (see
  // ProjectItem) — `updatedAt` on a completed task is the closest available
  // proxy for when it was completed.
  get doneLast7(): number {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    return this.tasks.filter((t) => t.status === 'completed' && new Date(t.updatedAt).getTime() >= cutoff).length;
  }

  get updatedLast7(): number {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    return this.tasks.filter((t) => new Date(t.updatedAt).getTime() >= cutoff).length;
  }

  get newLast7(): number {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    return this.tasks.filter((t) => new Date(t.createdAt).getTime() >= cutoff).length;
  }

  // Excludes already-completed tasks — a finished task isn't "due" anymore
  // even if its end date falls in the window.
  get dueNext7(): number {
    const now = Date.now();
    const cutoff = now + SEVEN_DAYS_MS;
    return this.tasks.filter((t) => {
      if (t.status === 'completed' || !t.endDate) return false;
      const due = new Date(t.endDate).getTime();
      return due >= now && due <= cutoff;
    }).length;
  }

  get statusCounts(): StatusCounts {
    const tasks = this.tasks;
    return {
      todo: tasks.filter((t) => t.status === 'todo').length,
      doing: tasks.filter((t) => t.status === 'doing').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      total: tasks.length,
    };
  }

  get donutPercent(): number {
    const { completed, total } = this.statusCounts;
    return total ? Math.round((completed / total) * 100) : 0;
  }

  get donutBackground(): string {
    const { todo, doing, completed, total } = this.statusCounts;
    if (!total) return 'conic-gradient(var(--border) 0 100%)';
    let acc = 0;
    const order: [ProjectItemStatus, number][] = [
      ['completed', completed],
      ['doing', doing],
      ['todo', todo],
    ];
    const stops = order.map(([status, count]) => {
      const from = acc;
      acc += (count / total) * 100;
      return `${STATUS_COLORS[status]} ${from}% ${acc}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }

  get statusLegend() {
    const { todo, doing, completed } = this.statusCounts;
    return [
      { key: 'completed', label: 'Done', count: completed, color: STATUS_COLORS.completed },
      { key: 'doing', label: 'In progress', count: doing, color: STATUS_COLORS.doing },
      { key: 'todo', label: 'To do', count: todo, color: STATUS_COLORS.todo },
    ];
  }

  // Assigned rows sorted by count descending (heaviest workload first);
  // Unassigned is always appended last regardless of its own count.
  get workload(): WorkloadRow[] {
    const tasks = this.tasks;
    const total = tasks.length;
    const byUser = new Map<number, { user: User; count: number }>();
    let unassignedCount = 0;

    for (const t of tasks) {
      if (!t.assignedTo) {
        unassignedCount++;
        continue;
      }
      const existing = byUser.get(t.assignedTo.id);
      if (existing) existing.count++;
      else byUser.set(t.assignedTo.id, { user: t.assignedTo, count: 1 });
    }

    const rows: WorkloadRow[] = Array.from(byUser.values())
      .sort((a, b) => b.count - a.count)
      .map((r, i) => ({
        user: r.user,
        count: r.count,
        percent: total ? Math.round((r.count / total) * 100) : 0,
        color: WORKLOAD_PALETTE[i % WORKLOAD_PALETTE.length],
      }));

    if (unassignedCount > 0) {
      rows.push({
        user: null,
        count: unassignedCount,
        percent: total ? Math.round((unassignedCount / total) * 100) : 0,
        color: UNASSIGNED_COLOR,
      });
    }

    return rows;
  }

  avatarUrl(user: User): string | null {
    if (this.brokenAvatarIds.has(user.id)) return null;
    return this.auth.avatarUrl(user);
  }

  onAvatarError(user: User) {
    this.brokenAvatarIds.add(user.id);
  }
}
