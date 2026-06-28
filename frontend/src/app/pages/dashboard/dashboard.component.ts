import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { TaskService } from '../../core/services/task.service';
import { Task } from '../../models/task.model';
import { User } from '../../models/user.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  user: User | null = null;
  tasks: Task[] = [];

  constructor(
    private auth: AuthService,
    private taskService: TaskService
  ) {}

  ngOnInit() {
    this.user = this.auth.getUser();
    this.taskService.getTasks().subscribe({ next: (tasks) => (this.tasks = tasks) });
  }

  get todo() { return this.tasks.filter((t) => t.status === 'todo').length; }
  get pending() { return this.tasks.filter((t) => t.status === 'pending').length; }
  get completed() { return this.tasks.filter((t) => t.status === 'completed').length; }
  get isManager() { return this.user?.role === 'Manager'; }
  get isTeamLead() { return this.user?.role === 'Team Lead'; }

  get completionRate(): number {
    if (!this.tasks.length) return 0;
    return Math.round((this.completed / this.tasks.length) * 100);
  }

  get greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  get roleIcon(): string {
    const icons: Record<string, string> = {
      Manager: 'bi-briefcase-fill',
      'Team Lead': 'bi-diagram-3-fill',
      Employee: 'bi-person-fill',
    };
    return icons[this.user?.role ?? ''] ?? 'bi-person-fill';
  }

}
