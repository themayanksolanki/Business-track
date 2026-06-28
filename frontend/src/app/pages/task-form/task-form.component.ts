import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TaskService } from '../../core/services/task.service';
import { UserService } from '../../core/services/user.service';
import { AuthService } from '../../core/services/auth.service';
import { User } from '../../models/user.model';

@Component({
  selector: 'app-task-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './task-form.component.html',
  styleUrl: './task-form.component.css',
})
export class TaskFormComponent implements OnInit {
  form: FormGroup;
  error = '';
  loading = false;
  assignableUsers: User[] = [];

  constructor(
    private fb: FormBuilder,
    private taskService: TaskService,
    private userService: UserService,
    public auth: AuthService,
    private router: Router
  ) {
    this.form = this.fb.group({
      title: ['', Validators.required],
      description: [''],
      assignedTo: [''],
    });
  }

  ngOnInit() {
    const role = this.auth.getUser()?.role;

    if (role === 'Manager') {
      this.userService.getAllUsers().subscribe({ next: (u) => (this.assignableUsers = u) });
    } else if (role === 'Team Lead') {
      this.userService.getTeamMembers().subscribe({ next: (u) => (this.assignableUsers = u) });
    }
  }

  get isEmployee() { return this.auth.getUser()?.role === 'Employee'; }

  get selectedAssigneeLabel() {
    const id = this.form.get('assignedTo')?.value;
    if (!id) return '-- Assign to self --';
    const u = this.assignableUsers.find((u) => (u.id ?? u._id) === id);
    return u ? `${u.username} (${u.role})` : '-- Assign to self --';
  }

  selectAssignee(user: User | null) {
    this.form.get('assignedTo')?.setValue(user ? (user.id ?? user._id ?? '') : '');
  }

  submit() {
    if (this.form.invalid) return;
    this.loading = true;
    this.error = '';

    const payload = { ...this.form.value };
    if (!payload.assignedTo) delete payload.assignedTo;

    this.taskService.createTask(payload).subscribe({
      next: () => this.router.navigate(['/tasks']),
      error: (err) => {
        this.error = err.error?.message || 'Failed to create task';
        this.loading = false;
      },
    });
  }
}
