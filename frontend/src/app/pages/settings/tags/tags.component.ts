import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TagService } from '../../../core/services/tag.service';
import { AuthService } from '../../../core/services/auth.service';
import { Tag } from '../../../models/tag.model';
import { TagFormComponent, TagFormMode, TagFormPayload } from '../../../shared/tag-form/tag-form.component';
import { TagPillComponent } from '../../../shared/tag-pill/tag-pill.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';

type FormMode = TagFormMode;

@Component({
  selector: 'app-tags',
  standalone: true,
  imports: [FormsModule, TagFormComponent, TagPillComponent, ConfirmDialogComponent],
  templateUrl: './tags.component.html',
  styleUrl: './tags.component.css',
})
export class TagsComponent implements OnInit {
  readonly isManager: boolean;

  tags: Tag[] = [];
  search = '';
  loading = false;
  error = '';

  formOpen = false;
  formMode: FormMode = 'create';
  editingId: number | null = null;
  formInitial: TagFormPayload | null = null;
  formLoading = false;
  formError = '';

  confirmOpen = false;
  confirmTarget: Tag | null = null;
  confirmLoading = false;

  get filteredTags(): Tag[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.tags;
    return this.tags.filter((t) => t.name.toLowerCase().includes(q));
  }

  get confirmMessage(): string {
    if (!this.confirmTarget) return '';
    const projectCount = this.confirmTarget.projectCount ?? 0;
    const taskCount = this.confirmTarget.taskCount ?? 0;
    const usage: string[] = [];
    if (projectCount) usage.push(`${projectCount} project${projectCount === 1 ? '' : 's'}`);
    if (taskCount) usage.push(`${taskCount} task${taskCount === 1 ? '' : 's'}`);
    const suffix = usage.length
      ? ` It is currently used on ${usage.join(' and ')}; deleting it will remove it from all of them.`
      : '';
    return `Delete "${this.confirmTarget.name}"? This cannot be undone.${suffix}`;
  }

  constructor(
    private tagService: TagService,
    private auth: AuthService
  ) {
    const role = this.auth.getUser()?.role;
    this.isManager = role === 'Admin' || role === 'Manager';
  }

  ngOnInit() {
    this.loadTags();
  }

  loadTags() {
    this.loading = true;
    this.error = '';
    this.tagService.refreshTags().subscribe({
      next: (res) => {
        this.tags = res;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load tags';
        this.loading = false;
      },
    });
  }

  openCreate() {
    this.formMode = 'create';
    this.editingId = null;
    this.formInitial = null;
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(tag: Tag) {
    this.formMode = 'edit';
    this.editingId = tag.id;
    this.formInitial = { name: tag.name, textColor: tag.textColor, backgroundColor: tag.backgroundColor };
    this.formError = '';
    this.formOpen = true;
  }

  closeForm() {
    this.formOpen = false;
    this.formError = '';
  }

  submitForm(payload: TagFormPayload) {
    this.formLoading = true;
    this.formError = '';

    const request =
      this.formMode === 'create'
        ? this.tagService.createTag(payload)
        : this.tagService.updateTag(this.editingId!, payload);

    request.subscribe({
      next: () => {
        this.formLoading = false;
        this.closeForm();
        this.loadTags();
      },
      error: (err) => {
        this.formError = err.error?.message || 'Failed to save tag';
        this.formLoading = false;
      },
    });
  }

  requestDelete(tag: Tag) {
    this.confirmTarget = tag;
    this.confirmOpen = true;
  }

  closeConfirm() {
    this.confirmOpen = false;
    this.confirmTarget = null;
  }

  confirmDelete() {
    if (!this.confirmTarget) return;
    this.confirmLoading = true;
    this.tagService.deleteTag(this.confirmTarget.id).subscribe({
      next: () => {
        this.confirmLoading = false;
        this.closeConfirm();
        this.loadTags();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to delete tag';
        this.confirmLoading = false;
        this.closeConfirm();
      },
    });
  }
}
