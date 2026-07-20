import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ProjectRoleService } from '../../../core/services/project-role.service';
import { AuthService } from '../../../core/services/auth.service';
import { ProjectRole } from '../../../models/project-role.model';
import {
  ProjectRoleFormComponent,
  ProjectRoleFormMode,
  ProjectRoleFormPayload,
} from '../../../shared/project-role-form/project-role-form.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-project-roles',
  standalone: true,
  imports: [FormsModule, DragDropModule, ProjectRoleFormComponent, ConfirmDialogComponent],
  templateUrl: './project-roles.component.html',
  styleUrl: './project-roles.component.css',
})
export class ProjectRolesComponent implements OnInit {
  readonly isManager: boolean;

  roles: ProjectRole[] = [];
  loading = false;
  error = '';

  formOpen = false;
  formMode: ProjectRoleFormMode = 'create';
  editingId: number | null = null;
  formInitial: ProjectRoleFormPayload | null = null;
  formTitleLocked = false;
  formLoading = false;
  formError = '';

  confirmOpen = false;
  confirmTarget: ProjectRole | null = null;
  confirmLoading = false;

  constructor(
    private projectRoleService: ProjectRoleService,
    private auth: AuthService
  ) {
    const role = this.auth.getUser()?.role;
    this.isManager = role === 'Admin' || role === 'Manager';
  }

  ngOnInit() {
    this.loadRoles();
  }

  loadRoles() {
    this.loading = true;
    this.error = '';
    this.projectRoleService.getRoles().subscribe({
      next: (res) => {
        this.roles = res;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load roles';
        this.loading = false;
      },
    });
  }

  get confirmMessage(): string {
    if (!this.confirmTarget) return '';
    const count = this.confirmTarget.membersUsingCount ?? 0;
    const suffix = count
      ? ` It is currently assigned to members in ${count} project${count === 1 ? '' : 's'} — reassign them first.`
      : '';
    return `Delete "${this.confirmTarget.title}"? This cannot be undone.${suffix}`;
  }

  openCreate() {
    this.formMode = 'create';
    this.editingId = null;
    this.formInitial = null;
    this.formTitleLocked = false;
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(role: ProjectRole) {
    this.formMode = 'edit';
    this.editingId = role.id;
    this.formInitial = { title: role.title, description: role.description };
    this.formTitleLocked = role.isDefault;
    this.formError = '';
    this.formOpen = true;
  }

  closeForm() {
    this.formOpen = false;
    this.formError = '';
  }

  submitForm(payload: ProjectRoleFormPayload) {
    this.formLoading = true;
    this.formError = '';

    const request =
      this.formMode === 'create'
        ? this.projectRoleService.createRole(payload)
        : this.projectRoleService.updateRole(this.editingId!, payload);

    request.subscribe({
      next: () => {
        this.formLoading = false;
        this.closeForm();
        this.loadRoles();
      },
      error: (err) => {
        this.formError = err.error?.message || 'Failed to save role';
        this.formLoading = false;
      },
    });
  }

  requestDelete(role: ProjectRole) {
    this.confirmTarget = role;
    this.confirmOpen = true;
  }

  closeConfirm() {
    this.confirmOpen = false;
    this.confirmTarget = null;
  }

  confirmDelete() {
    if (!this.confirmTarget) return;
    this.confirmLoading = true;
    this.projectRoleService.deleteRole(this.confirmTarget.id).subscribe({
      next: () => {
        this.confirmLoading = false;
        this.closeConfirm();
        this.loadRoles();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to delete role';
        this.confirmLoading = false;
        this.closeConfirm();
      },
    });
  }

  onDrop(event: CdkDragDrop<ProjectRole[]>) {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.roles, event.previousIndex, event.currentIndex);
    const orderedIds = this.roles.map((r) => r.id);
    this.projectRoleService.reorderRoles(orderedIds).subscribe({
      error: () => this.loadRoles(),
    });
  }
}
