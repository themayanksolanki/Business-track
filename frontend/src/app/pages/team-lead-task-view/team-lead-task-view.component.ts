import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskService } from '../../core/services/task.service';
import { UserService } from '../../core/services/user.service';
import { Task } from '../../models/task.model';
import { User } from '../../models/user.model';

interface MemberTaskCounts {
  todo: number;
  pending: number;
  completed: number;
}

@Component({
  selector: 'app-team-lead-task-view',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './team-lead-task-view.component.html',
  styleUrl: './team-lead-task-view.component.css',
})
export class TeamLeadTaskViewComponent implements OnInit {
  tasks: Task[] = [];
  members: User[] = [];
  error = '';
  selectedMemberId = '';

  private memberTaskCounts = new Map<string, MemberTaskCounts>();

  constructor(private taskService: TaskService, private userService: UserService) {}

  ngOnInit() {
    this.taskService.getTasks().subscribe({
      next: (t) => {
        this.tasks = t;
        this.rebuildMemberTaskCounts();
      },
    });
    this.userService.getTeamMembers().subscribe({ next: (m) => (this.members = m) });
  }

  private rebuildMemberTaskCounts() {
    const counts = new Map<string, MemberTaskCounts>();
    for (const t of this.tasks) {
      const id = t.assignedTo?._id ?? (t.assignedTo as any)?.id;
      if (!id) continue;
      const entry = counts.get(id) ?? { todo: 0, pending: 0, completed: 0 };
      if (t.status === 'todo') entry.todo++;
      else if (t.status === 'pending') entry.pending++;
      else if (t.status === 'completed') entry.completed++;
      counts.set(id, entry);
    }
    this.memberTaskCounts = counts;
  }

  get filteredTasks(): Task[] {
    if (!this.selectedMemberId) return this.tasks;
    return this.tasks.filter((t) => {
      const id = t.assignedTo?._id ?? (t.assignedTo as any)?.id;
      return id === this.selectedMemberId;
    });
  }

  todoFor(memberId: string): number {
    return this.memberTaskCounts.get(memberId)?.todo ?? 0;
  }

  pendingFor(memberId: string): number {
    return this.memberTaskCounts.get(memberId)?.pending ?? 0;
  }

  completedFor(memberId: string): number {
    return this.memberTaskCounts.get(memberId)?.completed ?? 0;
  }
}
