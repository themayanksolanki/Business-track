import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DepartmentService } from '../../../core/services/department.service';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { Department, DepartmentDetail } from '../../../models/department.model';
import { User } from '../../../models/user.model';
import { DepartmentFormComponent, DepartmentFormMode, DepartmentFormPayload } from '../../../shared/department-form/department-form.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';

type FormMode = DepartmentFormMode;

@Component({
  selector: 'app-departments',
  standalone: true,
  imports: [RouterLink, DepartmentFormComponent, ConfirmDialogComponent],
  templateUrl: './departments.component.html',
  styleUrl: './departments.component.css',
})
export class DepartmentsComponent implements OnInit {
  readonly isManager: boolean;

  departments: Department[] = [];
  ordered: Department[] = [];
  collapsedIds = new Set<number>();
  private parentMap = new Map<number, number | null>();

  loading = false;
  error = '';

  readonly pageSize = 12;
  currentPage = 1;
  totalItems = 0;
  totalPages = 1;

  selectedId: number | null = null;
  detail: DepartmentDetail | null = null;
  detailLoading = false;
  detailError = '';

  allUsers: User[] = [];
  usersLoaded = false;
  userToggleError = '';

  formOpen = false;
  formMode: FormMode = 'create';
  editingId: number | null = null;
  formParentId: number | null = null;
  formParentName: string | null = null;
  formInitial: DepartmentFormPayload | null = null;
  formLoading = false;
  formError = '';

  confirmOpen = false;
  confirmTarget: Department | null = null;
  confirmLoading = false;

  get confirmMessage(): string {
    if (!this.confirmTarget) return '';
    const suffix = this.confirmTarget.childCount ? ' and all of its sub-departments' : '';
    return `Delete "${this.confirmTarget.name}"${suffix} — this cannot be undone. Users and projects assigned to it will be unassigned.`;
  }

  constructor(
    private departmentService: DepartmentService,
    private userService: UserService,
    private auth: AuthService
  ) {
    const role = this.auth.getUser()?.role;
    this.isManager = role === 'Admin' || role === 'Manager';
  }

  ngOnInit() {
    this.loadPage(1);
  }

  loadPage(page: number) {
    if (page < 1 || (page > this.totalPages && this.totalItems > 0)) return;
    this.loading = true;
    this.error = '';
    this.departmentService.getDepartmentsPage(page, this.pageSize).subscribe({
      next: (res) => {
        this.departments = res.departments;
        this.currentPage = res.page;
        this.totalItems = res.total;
        this.totalPages = res.totalPages;
        this.rebuildTree();
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load departments';
        this.loading = false;
      },
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

  private rebuildTree() {
    this.parentMap = new Map(this.departments.map((d) => [d.id, d.parentId]));

    const byParent = new Map<number | 'root', Department[]>();
    for (const d of this.departments) {
      const key = d.parentId ?? 'root';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(d);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

    const result: Department[] = [];
    const visit = (key: number | 'root') => {
      for (const child of byParent.get(key) ?? []) {
        result.push(child);
        visit(child.id);
      }
    };
    visit('root');
    this.ordered = result;
  }

  get visibleDepartments(): Department[] {
    return this.ordered.filter((d) => !this.hasCollapsedAncestor(d.parentId));
  }

  private hasCollapsedAncestor(parentId: number | null): boolean {
    let current = parentId;
    while (current) {
      if (this.collapsedIds.has(current)) return true;
      current = this.parentMap.get(current) ?? null;
    }
    return false;
  }

  isCollapsed(id: number): boolean {
    return this.collapsedIds.has(id);
  }

  toggleCollapse(id: number, event: Event) {
    event.stopPropagation();
    if (this.collapsedIds.has(id)) this.collapsedIds.delete(id);
    else this.collapsedIds.add(id);
  }

  selectDepartment(dept: Department) {
    this.selectedId = dept.id;
    this.detailError = '';
    this.detailLoading = true;
    this.departmentService.getDepartmentById(dept.id).subscribe({
      next: (res) => {
        this.detail = res;
        this.detailLoading = false;
        if (this.isManager) this.ensureUsersLoaded();
      },
      error: (err) => {
        this.detailError = err.error?.message || 'Failed to load department';
        this.detailLoading = false;
      },
    });
  }

  private reloadDetail() {
    if (!this.selectedId) return;
    this.departmentService.getDepartmentById(this.selectedId).subscribe({
      next: (res) => (this.detail = res),
      error: () => {},
    });
  }

  private ensureUsersLoaded() {
    if (this.usersLoaded) return;
    this.userService.getAllUsers().subscribe({
      next: (res) => {
        this.allUsers = res;
        this.usersLoaded = true;
      },
      error: () => {},
    });
  }

  isUserAssigned(user: User): boolean {
    if (!this.selectedId) return false;
    const ids = (user.departments as number[] | undefined) ?? [];
    return ids.includes(this.selectedId);
  }

  toggleUserAssignment(user: User, checked: boolean) {
    if (!this.selectedId) return;
    const current = (user.departments as number[] | undefined) ?? [];
    const updated = checked
      ? [...new Set([...current, this.selectedId])]
      : current.filter((id) => id !== this.selectedId);

    this.userToggleError = '';
    this.userService.updateUserDepartments(user.id, updated).subscribe({
      next: () => {
        user.departments = updated;
        this.reloadDetail();
        this.loadPage(this.currentPage);
      },
      error: (err) => {
        this.userToggleError = err.error?.message || 'Failed to update assignment';
      },
    });
  }

  openCreate(parent: Department | null) {
    this.formMode = 'create';
    this.editingId = null;
    this.formParentId = parent?.id ?? null;
    this.formParentName = parent?.name ?? null;
    this.formInitial = null;
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(dept: Department, event: Event) {
    event.stopPropagation();
    this.formMode = 'edit';
    this.editingId = dept.id;
    this.formParentId = dept.parentId;
    this.formParentName = null;
    this.formInitial = { name: dept.name, overview: dept.overview, color: dept.color };
    this.formError = '';
    this.formOpen = true;
  }

  closeForm() {
    this.formOpen = false;
    this.formError = '';
  }

  submitForm(payload: DepartmentFormPayload) {
    this.formLoading = true;
    this.formError = '';

    const request =
      this.formMode === 'create'
        ? this.departmentService.createDepartment({ ...payload, parentId: this.formParentId })
        : this.departmentService.updateDepartment(this.editingId!, payload);

    request.subscribe({
      next: () => {
        this.formLoading = false;
        this.closeForm();
        this.loadPage(this.currentPage);
        if (this.formMode === 'edit' && this.selectedId === this.editingId) this.reloadDetail();
      },
      error: (err) => {
        this.formError = err.error?.message || 'Failed to save department';
        this.formLoading = false;
      },
    });
  }

  requestDelete(dept: Department, event: Event) {
    event.stopPropagation();
    this.confirmTarget = dept;
    this.confirmOpen = true;
  }

  closeConfirm() {
    this.confirmOpen = false;
    this.confirmTarget = null;
  }

  confirmDelete() {
    if (!this.confirmTarget) return;
    this.confirmLoading = true;
    this.departmentService.deleteDepartment(this.confirmTarget.id).subscribe({
      next: () => {
        this.confirmLoading = false;
        if (this.selectedId === this.confirmTarget!.id) {
          this.selectedId = null;
          this.detail = null;
        }
        this.closeConfirm();
        this.loadPage(this.currentPage);
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to delete department';
        this.confirmLoading = false;
        this.closeConfirm();
      },
    });
  }
}
