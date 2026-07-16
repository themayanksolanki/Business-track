import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DepartmentService } from '../../../core/services/department.service';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { Department, DepartmentDetail } from '../../../models/department.model';
import { User } from '../../../models/user.model';
import { ModalDirective } from '../../../shared/modal.directive';

type FormMode = 'create' | 'edit';

@Component({
  selector: 'app-departments',
  standalone: true,
  imports: [FormsModule, RouterLink, ModalDirective],
  templateUrl: './departments.component.html',
  styleUrl: './departments.component.css',
})
export class DepartmentsComponent implements OnInit {
  readonly isManager: boolean;

  departments: Department[] = [];
  ordered: Department[] = [];
  collapsedIds = new Set<string>();
  private parentMap = new Map<string, string | null>();

  loading = false;
  error = '';

  selectedId: string | null = null;
  detail: DepartmentDetail | null = null;
  detailLoading = false;
  detailError = '';

  allUsers: User[] = [];
  usersLoaded = false;
  userToggleError = '';

  formOpen = false;
  formMode: FormMode = 'create';
  editingId: string | null = null;
  formParentId: string | null = null;
  formParentName: string | null = null;
  formName = '';
  formOverview = '';
  formColor = '#3b82f6';
  formLoading = false;
  formError = '';

  confirmOpen = false;
  confirmTarget: Department | null = null;
  confirmLoading = false;

  constructor(
    private departmentService: DepartmentService,
    private userService: UserService,
    private auth: AuthService
  ) {
    const role = this.auth.getUser()?.role;
    this.isManager = role === 'Admin' || role === 'Manager';
  }

  ngOnInit() {
    this.loadDepartments();
  }

  loadDepartments() {
    this.loading = true;
    this.error = '';
    this.departmentService.getDepartments().subscribe({
      next: (res) => {
        this.departments = res;
        this.rebuildTree();
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load departments';
        this.loading = false;
      },
    });
  }

  private rebuildTree() {
    this.parentMap = new Map(this.departments.map((d) => [d._id, d.parentId]));

    const byParent = new Map<string, Department[]>();
    for (const d of this.departments) {
      const key = d.parentId ?? 'root';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(d);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

    const result: Department[] = [];
    const visit = (key: string) => {
      for (const child of byParent.get(key) ?? []) {
        result.push(child);
        visit(child._id);
      }
    };
    visit('root');
    this.ordered = result;
  }

  get visibleDepartments(): Department[] {
    return this.ordered.filter((d) => !this.hasCollapsedAncestor(d.parentId));
  }

  private hasCollapsedAncestor(parentId: string | null): boolean {
    let current = parentId;
    while (current) {
      if (this.collapsedIds.has(current)) return true;
      current = this.parentMap.get(current) ?? null;
    }
    return false;
  }

  isCollapsed(id: string): boolean {
    return this.collapsedIds.has(id);
  }

  toggleCollapse(id: string, event: Event) {
    event.stopPropagation();
    if (this.collapsedIds.has(id)) this.collapsedIds.delete(id);
    else this.collapsedIds.add(id);
  }

  selectDepartment(dept: Department) {
    this.selectedId = dept._id;
    this.detailError = '';
    this.detailLoading = true;
    this.departmentService.getDepartmentById(dept._id).subscribe({
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
    const ids = (user.departments as string[] | undefined) ?? [];
    return ids.map(String).includes(this.selectedId);
  }

  toggleUserAssignment(user: User, checked: boolean) {
    if (!this.selectedId) return;
    const uid = (user._id ?? user.id) as string;
    const current = ((user.departments as string[] | undefined) ?? []).map(String);
    const updated = checked
      ? [...new Set([...current, this.selectedId])]
      : current.filter((id) => id !== this.selectedId);

    this.userToggleError = '';
    this.userService.updateUserDepartments(uid, updated).subscribe({
      next: () => {
        user.departments = updated;
        this.reloadDetail();
        this.loadDepartments();
      },
      error: (err) => {
        this.userToggleError = err.error?.message || 'Failed to update assignment';
      },
    });
  }

  openCreate(parent: Department | null) {
    this.formMode = 'create';
    this.editingId = null;
    this.formParentId = parent?._id ?? null;
    this.formParentName = parent?.name ?? null;
    this.formName = '';
    this.formOverview = '';
    this.formColor = '#3b82f6';
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(dept: Department, event: Event) {
    event.stopPropagation();
    this.formMode = 'edit';
    this.editingId = dept._id;
    this.formParentId = dept.parentId;
    this.formParentName = null;
    this.formName = dept.name;
    this.formOverview = dept.overview;
    this.formColor = dept.color;
    this.formError = '';
    this.formOpen = true;
  }

  closeForm() {
    this.formOpen = false;
    this.formError = '';
  }

  submitForm() {
    if (!this.formName.trim()) {
      this.formError = 'Name is required';
      return;
    }
    this.formLoading = true;
    this.formError = '';

    const payload = {
      name: this.formName.trim(),
      overview: this.formOverview,
      color: this.formColor,
    };

    const request =
      this.formMode === 'create'
        ? this.departmentService.createDepartment({ ...payload, parentId: this.formParentId })
        : this.departmentService.updateDepartment(this.editingId!, payload);

    request.subscribe({
      next: () => {
        this.formLoading = false;
        this.closeForm();
        this.loadDepartments();
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
    this.departmentService.deleteDepartment(this.confirmTarget._id).subscribe({
      next: () => {
        this.confirmLoading = false;
        if (this.selectedId === this.confirmTarget!._id) {
          this.selectedId = null;
          this.detail = null;
        }
        this.closeConfirm();
        this.loadDepartments();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to delete department';
        this.confirmLoading = false;
        this.closeConfirm();
      },
    });
  }
}
