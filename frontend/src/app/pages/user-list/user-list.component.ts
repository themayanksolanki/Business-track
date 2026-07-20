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
  activating: Set<number> = new Set();
  isTeamLead = false;

  readonly pageSize = 12;
  currentPage = 1;
  totalItems = 0;
  totalPages = 1;

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
    this.loadPendingAndInvited();

    if (this.isTeamLead) {
      this.userService.getTeamMembers().subscribe({
        next: (res) => (this.activeUsers = res),
        error: (err) => (this.error = err.error?.message || 'Failed to load users'),
      });
    } else {
      this.loadActivePage(1);
    }
  }

  private loadPendingAndInvited() {
    forkJoin({
      pending: this.userService.getPendingUsers(),
      invited: this.orgService.getInvites(),
    }).subscribe({
      next: ({ pending, invited }) => {
        this.pendingUsers = pending;
        this.invitedUsers = invited;
      },
      error: (err) => (this.error = err.error?.message || 'Failed to load users'),
    });
  }

  loadActivePage(page: number) {
    if (this.isTeamLead) return;
    if (page < 1 || (page > this.totalPages && this.totalItems > 0)) return;
    this.userService.getUsersPage(page, this.pageSize).subscribe({
      next: (res) => {
        this.activeUsers = res.users;
        this.currentPage = res.page;
        this.totalItems = res.total;
        this.totalPages = res.totalPages;
      },
      error: (err) => (this.error = err.error?.message || 'Failed to load users'),
    });
  }

  get pageNumbers(): number[] {
    const total = this.totalPages;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages: number[] = [1];
    const left = Math.max(2, this.currentPage - 1);
    const right = Math.min(total - 1, this.currentPage + 1);

    if (left > 2) pages.push(-1);
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < total - 1) pages.push(-1);
    pages.push(total);
    return pages;
  }

  get pageStart(): number {
    return this.totalItems === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalItems);
  }

  activate(user: User) {
    const id = user.id;
    this.activating.add(id);
    this.error = '';
    this.successMessage = '';

    this.userService.activateUser(id).subscribe({
      next: (res) => {
        this.successMessage = res.message;
        this.pendingUsers = this.pendingUsers.filter((u) => u.id !== id);
        this.activating.delete(id);
        this.userService.refreshUsers().subscribe();
        if (this.isTeamLead) {
          this.activeUsers = [...this.activeUsers, { ...user, isActive: true }];
        } else {
          this.loadActivePage(this.currentPage);
        }
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to activate user';
        this.activating.delete(id);
      },
    });
  }

  isActivating(user: User): boolean {
    return this.activating.has(user.id);
  }

  canEditPassword(user: User): boolean {
    const me = this.auth.getUser();
    if (!me) return false;
    if (user.id === me.id) return false;
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
    const id = this.editPassUser.id;
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
      .activateInvite(invite.id, { username: this.activateUsername.trim(), password: this.activatePassword })
      .subscribe({
        next: (res) => {
          this.activateSuccess = res.message;
          this.activateLoading = false;
          this.invitedUsers = this.invitedUsers.filter((i) => i.id !== invite.id);
          this.userService.refreshUsers().subscribe();
          if (this.isTeamLead) {
            this.activeUsers = [...this.activeUsers, res.user];
          } else {
            this.loadActivePage(this.currentPage);
          }
          setTimeout(() => this.closeActivateInvite(), 1600);
        },
        error: (err) => {
          this.activateError = err.error?.message || 'Failed to activate invite';
          this.activateLoading = false;
        },
      });
  }

  get totalCount(): number {
    const activeCount = this.isTeamLead ? this.activeUsers.length : this.totalItems;
    return activeCount + this.pendingUsers.length + this.invitedUsers.length;
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
