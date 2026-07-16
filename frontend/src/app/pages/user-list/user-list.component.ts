import { Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../core/services/user.service';
import { OrganizationService } from '../../core/services/organization.service';
import { AuthService } from '../../core/services/auth.service';
import { User } from '../../models/user.model';
import { Invite } from '../../models/invite.model';
import { ModalDirective } from '../../shared/modal.directive';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [FormsModule, ModalDirective],
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.css'],
})
export class UserListComponent implements OnInit {
  activeUsers: User[] = [];
  pendingUsers: User[] = [];
  invitedUsers: Invite[] = [];
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

  activateInviteTarget: Invite | null = null;
  activateUsername = '';
  activatePassword = '';
  activateShowPassword = false;
  activateLoading = false;
  activateError = '';
  activateSuccess = '';

  constructor(
    private userService: UserService,
    private orgService: OrganizationService,
    private auth: AuthService,
  ) {}

  ngOnInit() {
    this.isTeamLead = this.auth.getUser()?.role === 'Team Lead';
    this.loadUsers();
  }

  loadUsers() {
    const active$ = this.isTeamLead
      ? this.userService.getTeamMembers()
      : this.userService.getAllUsers();

    forkJoin({
      active: active$,
      pending: this.userService.getPendingUsers(),
      invited: this.orgService.getInvites(),
    }).subscribe({
      next: ({ active, pending, invited }) => {
        this.activeUsers = active;
        this.pendingUsers = pending;
        this.invitedUsers = invited;
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
    if (me.role === 'Admin') return true;
    if (me.role === 'Manager') return user.role === 'Team Lead' || user.role === 'User';
    if (me.role === 'Team Lead') return user.role === 'User';
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

  openActivateInvite(invite: Invite) {
    this.activateInviteTarget = invite;
    this.activateUsername = invite.email.split('@')[0];
    this.activatePassword = '';
    this.activateShowPassword = false;
    this.activateError = '';
    this.activateSuccess = '';
  }

  closeActivateInvite() {
    this.activateInviteTarget = null;
  }

  submitActivateInvite() {
    if (!this.activateInviteTarget) return;
    if (!this.activateUsername.trim()) {
      this.activateError = 'Username is required.';
      return;
    }
    if (this.activatePassword.length < 6) {
      this.activateError = 'Password must be at least 6 characters.';
      return;
    }

    const invite = this.activateInviteTarget;
    this.activateLoading = true;
    this.activateError = '';

    this.orgService
      .activateInvite(invite._id, { username: this.activateUsername.trim(), password: this.activatePassword })
      .subscribe({
        next: (res) => {
          this.activateSuccess = res.message;
          this.activateLoading = false;
          this.activeUsers = [...this.activeUsers, res.user];
          this.invitedUsers = this.invitedUsers.filter((i) => i._id !== invite._id);
          setTimeout(() => this.closeActivateInvite(), 1600);
        },
        error: (err) => {
          this.activateError = err.error?.message || 'Failed to activate invite';
          this.activateLoading = false;
        },
      });
  }

  get totalCount(): number {
    return this.activeUsers.length + this.pendingUsers.length + this.invitedUsers.length;
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  roleIcon(role: string): string {
    const icons: Record<string, string> = {
      Admin: 'bi-shield-fill-check',
      Manager: 'bi-briefcase-fill',
      'Team Lead': 'bi-diagram-3-fill',
      User: 'bi-person-fill',
    };
    return icons[role] ?? 'bi-person-fill';
  }
}
