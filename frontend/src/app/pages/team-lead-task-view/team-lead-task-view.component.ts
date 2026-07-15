import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TaskService } from '../../core/services/task.service';
import { UserService } from '../../core/services/user.service';
import { Task } from '../../models/task.model';
import { User } from '../../models/user.model';

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

  constructor(private taskService: TaskService, private userService: UserService) {}

  ngOnInit() {
    this.taskService.getTasks().subscribe({ next: (t) => (this.tasks = t) });
    this.userService.getTeamMembers().subscribe({ next: (m) => (this.members = m) });
  }

  get filteredTasks(): Task[] {
    if (!this.selectedMemberId) return this.tasks;
    return this.tasks.filter((t) => {
      const id = t.assignedTo?._id ?? (t.assignedTo as any)?.id;
      return id === this.selectedMemberId;
    });
  }

  todoFor(memberId: string) {
    return this.tasks.filter((t) => {
      const id = t.assignedTo?._id ?? (t.assignedTo as any)?.id;
      return id === memberId && t.status === 'todo';
    }).length;
  }

  pendingFor(memberId: string) {
    return this.tasks.filter((t) => {
      const id = t.assignedTo?._id ?? (t.assignedTo as any)?.id;
      return id === memberId && t.status === 'pending';
    }).length;
  }

  completedFor(memberId: string) {
    return this.tasks.filter((t) => {
      const id = t.assignedTo?._id ?? (t.assignedTo as any)?.id;
      return id === memberId && t.status === 'completed';
    }).length;
  }
}
