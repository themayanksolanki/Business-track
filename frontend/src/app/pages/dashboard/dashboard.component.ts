import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { ChatService } from '../../core/services/chat.service';
import { DashboardStats } from '../../models/dashboard.model';
import { User } from '../../models/user.model';

// Fixed status→color mapping, reused across every task/project chart on this
// page — a status color always means the same thing everywhere it appears.
const TASK_STATUS_COLORS: Record<string, string> = {
  todo: '#0284c7',
  pending: '#d97706',
  completed: '#16a34a',
};

const PROJECT_STATUS_COLORS: Record<string, string> = {
  active: '#3b82f6',
  completed: '#16a34a',
  archived: '#6b7280',
  draft: '#7c3aed',
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  user: User | null = null;
  stats: DashboardStats | null = null;
  loading = true;

  constructor(
    private auth: AuthService,
    private dashboardService: DashboardService,
    private chatService: ChatService,
  ) {}

  ngOnInit() {
    this.user = this.auth.getUser();
    this.dashboardService.getStats().subscribe({
      next: (stats) => {
        this.stats = stats;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
    this.chatService.prefetch();
  }

  get isAdmin() { return this.user?.role === 'Admin'; }
  get isManager() { return this.user?.role === 'Manager'; }
  get isTeamLead() { return this.user?.role === 'Team Lead'; }

  get completionRate(): number {
    const t = this.stats?.tasks;
    if (!t || !t.total) return 0;
    return Math.round((t.completed / t.total) * 100);
  }

  get greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  get roleIcon(): string {
    const icons: Record<string, string> = {
      Admin: 'bi-shield-fill-check',
      Manager: 'bi-briefcase-fill',
      'Team Lead': 'bi-diagram-3-fill',
      User: 'bi-person-fill',
    };
    return icons[this.user?.role ?? ''] ?? 'bi-person-fill';
  }

  // Task status donut — a pure-CSS conic-gradient ring, one arc per status,
  // in the same fixed order/colors as the legend below it.
  get taskDonutBackground(): string {
    const t = this.stats?.tasks;
    if (!t || !t.total) return 'conic-gradient(var(--border) 0 100%)';
    let acc = 0;
    const stops = (['todo', 'pending', 'completed'] as const).map((key) => {
      const from = acc;
      acc += (t[key] / t.total) * 100;
      return `${TASK_STATUS_COLORS[key]} ${from}% ${acc}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }

  get taskLegend() {
    const t = this.stats?.tasks;
    if (!t) return [];
    return [
      { key: 'todo', label: 'Todo', count: t.todo, color: TASK_STATUS_COLORS['todo'] },
      { key: 'pending', label: 'In Progress', count: t.pending, color: TASK_STATUS_COLORS['pending'] },
      { key: 'completed', label: 'Completed', count: t.completed, color: TASK_STATUS_COLORS['completed'] },
    ];
  }

  // Project status horizontal bars — one row per status, width scaled to the
  // largest single status so the tallest bar always reaches 100%.
  get projectStatusBars() {
    const p = this.stats?.projects;
    if (!p) return [];
    const rows = [
      { key: 'active', label: 'Active', count: p.active, color: PROJECT_STATUS_COLORS['active'] },
      { key: 'completed', label: 'Completed', count: p.completed, color: PROJECT_STATUS_COLORS['completed'] },
      { key: 'archived', label: 'Archived', count: p.archived, color: PROJECT_STATUS_COLORS['archived'] },
      { key: 'draft', label: 'Draft', count: p.draft, color: PROJECT_STATUS_COLORS['draft'] },
    ];
    const max = Math.max(1, ...rows.map((r) => r.count));
    return rows.map((r) => ({ ...r, width: Math.round((r.count / max) * 100) }));
  }

  get departmentBars() {
    const depts = this.stats?.departmentBreakdown;
    if (!depts?.length) return [];
    const max = Math.max(1, ...depts.map((d) => d.totalProjects));
    return depts.map((d) => ({ ...d, width: Math.round((d.totalProjects / max) * 100) }));
  }

  memberSegments(m: { todo: number; pending: number; completed: number; total: number }) {
    if (!m.total) return [];
    return [
      { key: 'todo', width: (m.todo / m.total) * 100, color: TASK_STATUS_COLORS['todo'] },
      { key: 'pending', width: (m.pending / m.total) * 100, color: TASK_STATUS_COLORS['pending'] },
      { key: 'completed', width: (m.completed / m.total) * 100, color: TASK_STATUS_COLORS['completed'] },
    ];
  }
}
