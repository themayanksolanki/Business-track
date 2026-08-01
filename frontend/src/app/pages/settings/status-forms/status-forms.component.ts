import { Component, OnInit } from '@angular/core';
import { StatusFormService } from '../../../core/services/status-form.service';
import { StatusForm, CreateStatusFormPayload, UpdateStatusFormPayload } from '../../../models/status-form.model';
import { StatusFormBuilderComponent, StatusFormBuilderMode } from '../../../shared/status-form-builder/status-form-builder.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';

@Component({
  selector: 'app-status-forms',
  standalone: true,
  imports: [StatusFormBuilderComponent, ConfirmDialogComponent, AppDatePipe],
  templateUrl: './status-forms.component.html',
  styleUrl: './status-forms.component.css',
})
export class StatusFormsComponent implements OnInit {
  forms: StatusForm[] = [];
  loading = false;
  error = '';

  formOpen = false;
  formMode: StatusFormBuilderMode = 'create';
  editingId: number | null = null;
  formInitial: StatusForm | null = null;
  formLoading = false;
  formError = '';

  confirmOpen = false;
  confirmTarget: StatusForm | null = null;
  confirmLoading = false;

  constructor(private statusFormService: StatusFormService) {}

  ngOnInit() {
    this.loadForms();
  }

  loadForms() {
    this.loading = true;
    this.error = '';
    this.statusFormService.refreshStatusForms().subscribe({
      next: (forms) => {
        this.forms = forms;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load status forms';
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

  // No separate fetch needed — the list already includes each form's full
  // question set (see getStatusForms' FORM_INCLUDE on the backend).
  openEdit(form: StatusForm) {
    this.formMode = 'edit';
    this.editingId = form.id;
    this.formInitial = form;
    this.formError = '';
    this.formOpen = true;
  }

  closeForm() {
    this.formOpen = false;
    this.formError = '';
  }

  submitForm(payload: CreateStatusFormPayload | UpdateStatusFormPayload) {
    this.formLoading = true;
    this.formError = '';

    const request =
      this.formMode === 'create'
        ? this.statusFormService.createStatusForm(payload)
        : this.statusFormService.updateStatusForm(this.editingId!, payload);

    request.subscribe({
      next: () => {
        this.formLoading = false;
        this.closeForm();
        this.loadForms();
      },
      error: (err) => {
        this.formError = err.error?.message || 'Failed to save status form';
        this.formLoading = false;
      },
    });
  }

  requestDelete(form: StatusForm) {
    this.confirmTarget = form;
    this.confirmOpen = true;
  }

  closeConfirm() {
    this.confirmOpen = false;
    this.confirmTarget = null;
  }

  confirmDelete() {
    if (!this.confirmTarget) return;
    this.confirmLoading = true;
    this.statusFormService.deleteStatusForm(this.confirmTarget.id).subscribe({
      next: () => {
        this.confirmLoading = false;
        this.closeConfirm();
        this.loadForms();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to delete status form';
        this.confirmLoading = false;
        this.closeConfirm();
      },
    });
  }
}
