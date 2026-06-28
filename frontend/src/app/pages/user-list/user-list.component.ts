import { Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../core/services/user.service';
import { AuthService } from '../../core/services/auth.service';
import { User } from '../../models/user.model';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.css'],
})
export class UserListComponent implements OnInit {
  activeUsers: User[] = [];
  pendingUsers: User[] = [];
  error = '';
  successMessage = '';
  activating: Set<string> = new Set();
  isTeamLead = false;

  editPassUser: User | null = null;
  editPassword = '';
  showPassword = false;
  editPassLoading = false;
  editPassError = '';
  editPassSuccess = '';

  constructor(private userService: UserService, private auth: AuthService) {}

  ngOnInit() {
    this.isTeamLead = this.auth.getUser()?.role === 'Team Lead';
    this.loadUsers();
  }

  loadUsers() {
    const active$ = this.isTeamLead
      ? this.userService.getTeamMembers()
      : this.userService.getAllUsers();

    forkJoin({ active: active$, pending: this.userService.getPendingUsers() }).subscribe({
      next: ({ active, pending }) => {
        this.activeUsers = active;
        this.pendingUsers = pending;
      },
      error: (err) => (this.error = err.error?.message || 'Failed to load users'),
    });
  }

  activate(user: User) {
    const id = (user._id ?? user.id) as string;
    this.activating.add(id);
    this.error = '';
    this.successMessage = '';

    this.userService.activateUser(id).subscribe({
      next: (res) => {
        this.successMessage = res.message;
        this.activeUsers = [...this.activeUsers, { ...user, isActive: true }];
        this.pendingUsers = this.pendingUsers.filter((u) => (u._id ?? u.id) !== id);
        this.activating.delete(id);
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to activate user';
        this.activating.delete(id);
      },
    });
  }

  isActivating(user: User): boolean {
    return this.activating.has((user._id ?? user.id) as string);
  }

  canEditPassword(user: User): boolean {
    const me = this.auth.getUser();
    if (!me) return false;
    const uid = user._id ?? user.id;
    const myId = me._id ?? me.id;
    if (uid === myId) return false;
    if (me.role === 'Manager') return user.role === 'Team Lead' || user.role === 'Employee';
    if (me.role === 'Team Lead') return user.role === 'Employee';
    return false;
  }

  openPassEdit(user: User) {
    this.editPassUser = user;
    this.editPassword = '';
    this.showPassword = false;
    this.editPassError = '';
    this.editPassSuccess = '';
  }

  closePassEdit() {
    this.editPassUser = null;
  }

  submitPassEdit() {
    if (!this.editPassUser) return;
    if (this.editPassword.length < 6) {
      this.editPassError = 'Password must be at least 6 characters.';
      return;
    }
    const id = (this.editPassUser._id ?? this.editPassUser.id) as string;
    this.editPassLoading = true;
    this.editPassError = '';
    this.userService.updateUserPassword(id, this.editPassword).subscribe({
      next: (res) => {
        this.editPassSuccess = res.message;
        this.editPassLoading = false;
        setTimeout(() => this.closePassEdit(), 1600);
      },
      error: (err) => {
        this.editPassError = err.error?.message || 'Failed to update password.';
        this.editPassLoading = false;
      },
    });
  }

  get totalCount(): number {
    return this.activeUsers.length + this.pendingUsers.length;
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  roleIcon(role: string): string {
    const icons: Record<string, string> = {
      Manager: 'bi-briefcase-fill',
      'Team Lead': 'bi-diagram-3-fill',
      Employee: 'bi-person-fill',
    };
    return icons[role] ?? 'bi-person-fill';
  }
}
