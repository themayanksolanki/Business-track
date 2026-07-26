import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CKEditorModule } from '@ckeditor/ckeditor5-angular';
import {
  ClassicEditor,
  Essentials,
  Paragraph,
  Heading,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link,
  List,
  BlockQuote,
  Indent,
  IndentBlock,
} from 'ckeditor5';
import { environment } from '../../../environments/environment';
import { ModalDirective } from '../modal.directive';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import { TabStripComponent, TabDef } from '../tab-strip/tab-strip.component';
import { Department } from '../../models/department.model';
import { Category } from '../../models/category.model';
import { User } from '../../models/user.model';
import { Metric, MetricStatus, MetricDataType, MetricParentLite, CreateMetricPayload, UpdateMetricPayload } from '../../models/metric.model';

export type MetricFormMode = 'create' | 'edit';

interface DataTypeOption {
  value: MetricDataType;
  label: string;
}

const DATA_TYPE_OPTIONS: DataTypeOption[] = [
  { value: 'number', label: 'Number' },
  { value: 'weight', label: 'Weight' },
  { value: 'currency', label: 'Currency' },
  { value: 'percentage', label: 'Percentage' },
];

@Component({
  selector: 'app-metric-form-modal',
  standalone: true,
  imports: [FormsModule, RouterLink, ModalDirective, ConfirmDialogComponent, DatePickerComponent, CKEditorModule, TabStripComponent],
  templateUrl: './metric-form-modal.component.html',
  styleUrl: './metric-form-modal.component.css',
})
export class MetricFormModalComponent implements OnChanges {
  readonly dataTypeOptions = DATA_TYPE_OPTIONS;
  readonly tabs: TabDef[] = [
    { key: 'statistics', label: 'Statistics', icon: 'bi-bar-chart' },
    { key: 'details', label: 'Details', icon: 'bi-info-circle' },
    { key: 'notes', label: 'Notes', icon: 'bi-journal-text' },
    { key: 'attachments', label: 'Attachments', icon: 'bi-paperclip' },
  ];
  activeTab = 'details';

  @Input() open = false;
  @Input() mode: MetricFormMode = 'create';
  @Input() initial: Metric | null = null;
  @Input() departments: Department[] = [];
  @Input() categories: Category[] = [];
  @Input() users: User[] = [];
  // Existing metrics for the "Parent" picker — excludes itself in edit mode
  // via `excludeId` rather than the caller pre-filtering, so the same
  // flat list loaded for the page table can be reused as-is.
  @Input() parentOptions: MetricParentLite[] = [];
  @Input() loading = false;
  @Input() error = '';
  @Input() deleteLoading = false;

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<CreateMetricPayload | UpdateMetricPayload>();
  // Emitted once the confirm dialog is accepted — the parent owns the
  // actual delete API call (mirrors CategoriesComponent owning
  // confirmDelete's request rather than CategoryFormComponent).
  @Output() deleteConfirmed = new EventEmitter<void>();

  readonly NotesEditor = ClassicEditor;
  readonly notesEditorConfig = {
    licenseKey: environment.ckeditorLicenseKey,
    plugins: [Essentials, Paragraph, Heading, Bold, Italic, Underline, Strikethrough, Link, List, BlockQuote, Indent, IndentBlock],
    toolbar: [
      'heading', '|',
      'bold', 'italic', 'underline', 'strikethrough', '|',
      'bulletedList', 'numberedList', '|',
      'outdent', 'indent', '|',
      'link', 'blockQuote', '|',
      'undo', 'redo',
    ],
  };

  title = '';
  department: number | null = null;
  category: number | null = null;
  owner: number | null = null;
  parentId: number | null = null;
  startDate: string | null = null;
  dueDate: string | null = null;
  notes = '';
  status: MetricStatus = 'active';
  dataType: MetricDataType = 'number';
  localError = '';
  confirmDeleteOpen = false;

  get displayError(): string {
    return this.localError || this.error;
  }

  get deleteConfirmMessage(): string {
    return `Delete "${this.title}" — it will be hidden from the Metrics page by default, but can still be found and restored to Active from the "All" filter.`;
  }

  get availableParents(): MetricParentLite[] {
    if (!this.initial) return this.parentOptions;
    return this.parentOptions.filter((m) => m.id !== this.initial!.id);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.title = this.initial?.title ?? '';
      this.department = this.initial?.department?.id ?? null;
      this.category = this.initial?.category?.id ?? null;
      this.owner = this.initial?.owner?.id ?? null;
      this.parentId = this.initial?.parent?.id ?? null;
      this.startDate = this.initial?.startDate ?? null;
      this.dueDate = this.initial?.dueDate ?? null;
      this.notes = this.initial?.notes ?? '';
      this.status = this.initial?.status ?? 'active';
      this.dataType = this.initial?.dataType ?? 'number';
      this.localError = '';
      this.confirmDeleteOpen = false;
      this.activeTab = 'details';
    }
  }

  setActiveTab(tab: string) {
    this.activeTab = tab;
  }

  onStartDateChange(date: string | null) {
    this.startDate = date;
    if (date && this.dueDate && date > this.dueDate) this.dueDate = date;
  }

  onDueDateChange(date: string | null) {
    this.dueDate = date;
    if (date && this.startDate && date < this.startDate) this.startDate = date;
  }

  submit() {
    if (!this.title.trim()) {
      this.localError = 'Title is required';
      return;
    }
    if (!this.department) {
      this.localError = 'Department is required';
      return;
    }
    if (!this.owner) {
      this.localError = 'Owner is required';
      return;
    }
    this.localError = '';

    const payload: CreateMetricPayload | UpdateMetricPayload = {
      title: this.title.trim(),
      department: this.department,
      category: this.category,
      owner: this.owner,
      parentId: this.parentId,
      startDate: this.startDate,
      dueDate: this.dueDate,
      notes: this.notes,
      dataType: this.dataType,
    };
    if (this.mode === 'edit') {
      (payload as UpdateMetricPayload).status = this.status;
    }
    this.submitted.emit(payload);
  }

  requestDelete() {
    this.confirmDeleteOpen = true;
  }

  cancelDelete() {
    this.confirmDeleteOpen = false;
  }

  confirmDelete() {
    this.deleteConfirmed.emit();
  }
}
