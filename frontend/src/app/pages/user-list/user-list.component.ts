import { Component, OnInit, OnDestroy } from '@angular/core';
import { forkJoin, Subscription, filter } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { UserService } from '../../core/services/user.service';
import { OrganizationService } from '../../core/services/organization.service';
import { AuthService } from '../../core/services/auth.service';
import { DepartmentService } from '../../core/services/department.service';
import { SocketService } from '../../core/services/socket.service';
import { User, Role, UpdateUserPayload, ReassignableWork } from '../../models/user.model';
import { Invite, CreateInvitePayload } from '../../models/invite.model';
import { Department } from '../../models/department.model';
import { ModalDirective } from '../../shared/modal.directive';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { NotificationService } from '../../shared/notification.service';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [FormsModule, NgbDropdownModule, ModalDirective, ConfirmDialogComponent],
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.css'],
})
export class UserListComponent implements OnInit, OnDestroy {
  activeUsers: User[] = [];
  pendingUsers: User[] = [];
  invitedUsers: Invite[] = [];
  error = '';
  successMessage = '';
  activating: Set<number> = new Set();

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

  // ── Add User (invite) ──
  inviteOpen = false;
  inviteEmail = '';
  inviteRole: Role = 'User';
  inviteDepartmentIds: number[] = [];
  inviteLoading = false;
  inviteError = '';

  // ── Edit User ──
  editUserTarget: User | null = null;
  editUsername = '';
  editEmail = '';
  editRole: Role = 'User';
  editDepartmentIds: number[] = [];
  editLoading = false;
  editError = '';

  // ── Deactivate (CRUD "Delete") ──
  reassignChecking = false;
  deactivateConfirmTarget: User | null = null;
  deactivateLoading = false;

  reassignTarget: User | null = null;
  reassignWork: ReassignableWork | null = null;
  reassignToId: number | null = null;
  reassignLoading = false;
  reassignError = '';

  // ── Bulk actions (active users only) ──
  selectedIds = new Set<number>();

  bulkDeactivateConfirmOpen = false;
  bulkActionLoading = false;

  bulkDeleteChecking = false;
  bulkDeleteOpen = false;
  bulkReassignWork: ReassignableWork | null = null;
  bulkReassignToId: number | null = null;
  bulkReassignLoading = false;
  bulkReassignError = '';

  get departments(): Department[] {
    return this.departmentService.departments();
  }

  private socketSub = new Subscription();

  constructor(
    private userService: UserService,
    private orgService: OrganizationService,
    private auth: AuthService,
    private departmentService: DepartmentService,
    private notifications: NotificationService,
    private socketService: SocketService,
  ) {}

  ngOnInit() {
    this.loadPendingAndInvited();
    this.loadActivePage(1);

    if (this.canManageUsers) {
      this.departmentService.ensureDepartmentsLoaded();
      // A queued deactivate-and-reassign job (see userService.deactivateUser)
      // finishes asynchronously in the backend — this is what makes the row
      // actually disappear once it's done, instead of requiring a manual
      // refresh. The toast itself is already shown app-wide by app.component.
      this.socketSub.add(
        this.socketService.notification$
          .pipe(filter((n) => n.type === 'userDeactivated'))
          .subscribe(() => this.loadActivePage(this.currentPage)),
      );
    }
  }

  ngOnDestroy() {
    this.socketSub.unsubscribe();
  }

  get canManageUsers(): boolean {
    const role = this.auth.getUser()?.role;
    return role === 'Admin' || role === 'Manager';
  }

  get invitableRoles(): Role[] {
    const me = this.auth.getUser()?.role;
    if (me === 'Admin') return ['Admin', 'Manager', 'Team Lead', 'User'];
    if (me === 'Manager') return ['Team Lead', 'User'];
    return [];
  }

  editableRolesFor(user: User): Role[] {
    const base = this.invitableRoles;
    return base.includes(user.role) ? base : [...base, user.role];
  }

  // Same rank boundary as canEditPassword — Admin manages everyone, Manager
  // manages Team Lead/User, and never yourself. Gates both Edit and
  // Deactivate, since they share the same "who can manage whom" rule.
  canManageUser(user: User): boolean {
    const me = this.auth.getUser();
    if (!me || !this.canManageUsers) return false;
    if (user.id === me.id) return false;
    if (me.role === 'Admin') return true;
    if (me.role === 'Manager') return user.role === 'Team Lead' || user.role === 'User';
    return false;
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
    if (page < 1 || (page > this.totalPages && this.totalItems > 0)) return;
    this.userService.getUsersPage(page, this.pageSize).subscribe({
      next: (res) => {
        this.activeUsers = res.users;
        this.currentPage = res.page;
        this.totalItems = res.total;
        this.totalPages = res.totalPages;
        this.selectedIds.clear();
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
        this.loadActivePage(this.currentPage);
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
          this.loadActivePage(this.currentPage);
          setTimeout(() => this.closeActivateInvite(), 1600);
        },
        error: (err) => {
          this.activateError = err.error?.message || 'Failed to activate invite';
          this.activateLoading = false;
        },
      });
  }

  // ── Add User (invite) ──
  openInvite() {
    this.inviteOpen = true;
    this.inviteEmail = '';
    this.inviteRole = this.invitableRoles[0] ?? 'User';
    this.inviteDepartmentIds = [];
    this.inviteError = '';
  }

  closeInvite() {
    this.inviteOpen = false;
  }

  isInviteDepartmentSelected(id: number): boolean {
    return this.inviteDepartmentIds.includes(id);
  }

  toggleInviteDepartment(id: number, checked: boolean) {
    this.inviteDepartmentIds = checked
      ? [...this.inviteDepartmentIds, id]
      : this.inviteDepartmentIds.filter((d) => d !== id);
  }

  submitInvite() {
    if (!this.inviteEmail.trim()) return;
    this.inviteLoading = true;
    this.inviteError = '';

    const payload: CreateInvitePayload = { email: this.inviteEmail.trim(), role: this.inviteRole };
    if (this.inviteDepartmentIds.length) payload.departments = this.inviteDepartmentIds;

    this.orgService.createInvite(payload).subscribe({
      next: (res) => {
        this.invitedUsers = [res.invite, ...this.invitedUsers];
        this.inviteLoading = false;
        this.notifications.success(`Invite sent to ${res.invite.email}`);
        this.closeInvite();
      },
      error: (err) => {
        this.inviteError = err.error?.message || 'Failed to create invite';
        this.inviteLoading = false;
      },
    });
  }

  // ── Edit User ──
  openEdit(user: User) {
    this.editUserTarget = user;
    this.editUsername = user.username;
    this.editEmail = user.email;
    this.editRole = user.role;
    // getAllUsers()/getUsersPage() populate this as Department[] (see
    // departments.component.ts for the same cast idiom against this union type).
    this.editDepartmentIds = ((user.departments as Department[] | undefined) ?? []).map((d) => d.id);
    this.editError = '';
  }

  closeEdit() {
    this.editUserTarget = null;
  }

  isEditDepartmentSelected(id: number): boolean {
    return this.editDepartmentIds.includes(id);
  }

  toggleEditDepartment(id: number, checked: boolean) {
    this.editDepartmentIds = checked
      ? [...this.editDepartmentIds, id]
      : this.editDepartmentIds.filter((d) => d !== id);
  }

  submitEdit() {
    if (!this.editUserTarget) return;
    if (!this.editUsername.trim()) {
      this.editError = 'Username cannot be empty.';
      return;
    }

    const target = this.editUserTarget;
    this.editLoading = true;
    this.editError = '';

    const payload: UpdateUserPayload = { username: this.editUsername.trim(), email: this.editEmail.trim() };
    if (this.editRole !== target.role) payload.role = this.editRole;

    this.userService.updateUser(target.id, payload).subscribe({
      next: () => {
        this.userService.updateUserDepartments(target.id, this.editDepartmentIds).subscribe({
          next: (res) => {
            this.patchActiveUser(res.user);
            this.editLoading = false;
            this.userService.refreshUsers().subscribe();
            this.notifications.success(`${res.user.username} updated`);
            this.closeEdit();
          },
          error: (err) => {
            this.editError = err.error?.message || 'User updated, but failed to update departments';
            this.editLoading = false;
          },
        });
      },
      error: (err) => {
        this.editError = err.error?.message || 'Failed to update user';
        this.editLoading = false;
      },
    });
  }

  private patchActiveUser(user: User) {
    this.activeUsers = this.activeUsers.map((u) => (u.id === user.id ? user : u));
  }

  private removeActiveUser(id: number) {
    this.activeUsers = this.activeUsers.filter((u) => u.id !== id);
    this.totalItems = Math.max(0, this.totalItems - 1);
  }

  // ── Deactivate (CRUD "Delete") ──
  get reassignHandlerOptions(): User[] {
    return this.activeUsers.filter((u) => u.id !== this.reassignTarget?.id);
  }

  // "Deactivate" — quick, no reassignment prompt. Leaves any currently
  // assigned work exactly where it is (still pointing at the now-disabled
  // account) — for when the admin already knows there's nothing to hand off,
  // or wants to disable login immediately without dealing with reassignment
  // right now. Contrast with openDelete below.
  openQuickDeactivate(user: User) {
    this.deactivateConfirmTarget = user;
  }

  // "Delete" — always asks who should take over the user's work, even if
  // they currently have none (the reassign-work summary just renders empty
  // in that case — see the "No open work" fallback in the template). This
  // is the explicit, deliberate deletion path; "Deactivate" above is the
  // quick one that skips this prompt entirely.
  openDelete(user: User) {
    this.reassignChecking = true;
    this.error = '';
    this.userService.getReassignableWork(user.id).subscribe({
      next: (work) => {
        this.reassignChecking = false;
        this.reassignTarget = user;
        this.reassignWork = work;
        this.reassignToId = null;
        this.reassignError = '';
      },
      error: (err) => {
        this.reassignChecking = false;
        this.notifications.error(err.error?.message || 'Failed to check assigned work');
      },
    });
  }

  cancelDeactivateConfirm() {
    this.deactivateConfirmTarget = null;
  }

  confirmDeactivateSimple() {
    if (!this.deactivateConfirmTarget) return;
    const target = this.deactivateConfirmTarget;
    this.deactivateLoading = true;

    this.userService.deactivateUser(target.id).subscribe({
      next: (res) => {
        this.deactivateLoading = false;
        this.deactivateConfirmTarget = null;
        this.removeActiveUser(target.id);
        this.userService.refreshUsers().subscribe();
        this.notifications.success(res.message);
      },
      error: (err) => {
        this.deactivateLoading = false;
        this.notifications.error(err.error?.message || 'Failed to deactivate user');
      },
    });
  }

  get hasReassignableWork(): boolean {
    const w = this.reassignWork;
    return !!w && w.assignedTasks + w.assignedProjectItems + w.ownedProjects + w.projectMemberships > 0;
  }

  cancelReassign() {
    this.reassignTarget = null;
    this.reassignWork = null;
  }

  confirmReassignAndDeactivate() {
    if (!this.reassignTarget || !this.reassignToId) return;
    const target = this.reassignTarget;
    this.reassignLoading = true;
    this.reassignError = '';

    this.userService.deactivateUser(target.id, this.reassignToId).subscribe({
      next: (res) => {
        this.reassignLoading = false;
        this.reassignTarget = null;
        this.reassignWork = null;
        if (res.queued) {
          // Reassignment now runs as a background job — the user isn't
          // deactivated yet, so the row stays as-is until the
          // 'userDeactivated' notification (see ngOnInit) refreshes the list.
          this.notifications.success(res.message);
        } else if (res.user) {
          this.removeActiveUser(target.id);
          this.userService.refreshUsers().subscribe();
          this.notifications.success(res.message);
        }
      },
      error: (err) => {
        this.reassignError = err.error?.message || 'Failed to deactivate user';
        this.reassignLoading = false;
      },
    });
  }

  get totalCount(): number {
    return this.totalItems + this.pendingUsers.length + this.invitedUsers.length;
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

  selectInviteRole(role: Role) {
    this.inviteRole = role;
  }

  selectEditRole(role: Role) {
    this.editRole = role;
  }

  get reassignToUser(): User | null {
    return this.reassignHandlerOptions.find((u) => u.id === this.reassignToId) ?? null;
  }

  selectReassignTo(id: number) {
    this.reassignToId = id;
  }

  // ── Bulk actions (active users only) ──
  get selectableActiveUsers(): User[] {
    return this.activeUsers.filter((u) => this.canManageUser(u));
  }

  get allSelected(): boolean {
    const selectable = this.selectableActiveUsers;
    return selectable.length > 0 && selectable.every((u) => this.selectedIds.has(u.id));
  }

  isSelected(id: number): boolean {
    return this.selectedIds.has(id);
  }

  toggleSelect(id: number, checked: boolean) {
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
  }

  toggleSelectAll(checked: boolean) {
    for (const u of this.selectableActiveUsers) {
      if (checked) this.selectedIds.add(u.id);
      else this.selectedIds.delete(u.id);
    }
  }

  clearSelection() {
    this.selectedIds.clear();
  }

  openBulkDeactivate() {
    if (this.selectedIds.size === 0) return;
    this.bulkDeactivateConfirmOpen = true;
  }

  cancelBulkDeactivate() {
    this.bulkDeactivateConfirmOpen = false;
  }

  // Bulk "Deactivate" mirrors the per-row quick deactivate — no reassignment
  // prompt, work already assigned to these users is left as-is.
  confirmBulkDeactivate() {
    const ids = Array.from(this.selectedIds);
    if (ids.length === 0) return;
    this.bulkActionLoading = true;

    forkJoin(ids.map((id) => this.userService.deactivateUser(id))).subscribe({
      next: (results) => {
        this.bulkActionLoading = false;
        this.bulkDeactivateConfirmOpen = false;
        ids.forEach((id) => this.removeActiveUser(id));
        this.selectedIds.clear();
        this.userService.refreshUsers().subscribe();
        this.notifications.success(`${results.length} user${results.length !== 1 ? 's' : ''} deactivated`);
      },
      error: (err) => {
        this.bulkActionLoading = false;
        this.notifications.error(err.error?.message || 'Failed to deactivate selected users');
      },
    });
  }

  get bulkReassignHandlerOptions(): User[] {
    return this.activeUsers.filter((u) => !this.selectedIds.has(u.id));
  }

  // Bulk "Delete" mirrors the per-row reassign-and-delete flow: check
  // combined open work across every selected user, then require a single
  // handler to take it all over before deleting.
  openBulkDelete() {
    const ids = Array.from(this.selectedIds);
    if (ids.length === 0) return;
    this.bulkDeleteChecking = true;
    this.error = '';

    forkJoin(ids.map((id) => this.userService.getReassignableWork(id))).subscribe({
      next: (works) => {
        this.bulkDeleteChecking = false;
        this.bulkReassignWork = works.reduce(
          (acc, w) => ({
            assignedTasks: acc.assignedTasks + w.assignedTasks,
            assignedProjectItems: acc.assignedProjectItems + w.assignedProjectItems,
            ownedProjects: acc.ownedProjects + w.ownedProjects,
            projectMemberships: acc.projectMemberships + w.projectMemberships,
          }),
          { assignedTasks: 0, assignedProjectItems: 0, ownedProjects: 0, projectMemberships: 0 },
        );
        this.bulkReassignToId = null;
        this.bulkReassignError = '';
        this.bulkDeleteOpen = true;
      },
      error: (err) => {
        this.bulkDeleteChecking = false;
        this.notifications.error(err.error?.message || 'Failed to check assigned work');
      },
    });
  }

  cancelBulkDelete() {
    this.bulkDeleteOpen = false;
    this.bulkReassignWork = null;
  }

  get bulkHasReassignableWork(): boolean {
    const w = this.bulkReassignWork;
    return !!w && w.assignedTasks + w.assignedProjectItems + w.ownedProjects + w.projectMemberships > 0;
  }

  get bulkReassignToUser(): User | null {
    return this.bulkReassignHandlerOptions.find((u) => u.id === this.bulkReassignToId) ?? null;
  }

  selectBulkReassignTo(id: number) {
    this.bulkReassignToId = id;
  }

  confirmBulkReassignAndDelete() {
    if (!this.bulkReassignToId) return;
    const ids = Array.from(this.selectedIds);
    const targetId = this.bulkReassignToId;
    this.bulkReassignLoading = true;
    this.bulkReassignError = '';

    forkJoin(ids.map((id) => this.userService.deactivateUser(id, targetId))).subscribe({
      next: (results) => {
        this.bulkReassignLoading = false;
        this.bulkDeleteOpen = false;
        this.bulkReassignWork = null;
        this.selectedIds.clear();

        const queuedCount = results.filter((r) => r.queued).length;
        const doneCount = results.length - queuedCount;
        if (doneCount > 0) {
          ids.forEach((id, i) => {
            if (!results[i].queued) this.removeActiveUser(id);
          });
          this.userService.refreshUsers().subscribe();
        }
        if (queuedCount > 0) {
          this.notifications.success(
            `${queuedCount} deletion${queuedCount !== 1 ? 's' : ''} queued — you'll be notified when done`,
          );
        }
        if (doneCount > 0) {
          this.notifications.success(`${doneCount} user${doneCount !== 1 ? 's' : ''} deleted`);
        }
      },
      error: (err) => {
        this.bulkReassignLoading = false;
        this.bulkReassignError = err.error?.message || 'Failed to delete selected users';
      },
    });
  }
}
