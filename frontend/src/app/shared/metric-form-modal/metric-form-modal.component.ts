import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
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
import { AttachmentsComponent } from '../attachments/attachments.component';
import { TrendChartComponent, TrendChartSeries } from '../trend-chart/trend-chart.component';
import { GaugeChartComponent } from '../gauge-chart/gauge-chart.component';
import { currentPeriodInfo } from '../utils/metric-period.util';
import { TREND_ACTUAL_COLOR, TREND_TARGET_COLOR, trendPeriodLabel, trendWindow } from '../utils/metric-trend.util';
import { formatMetricValue } from '../utils/metric-value.util';
import { Department } from '../../models/department.model';
import { Category } from '../../models/category.model';
import { User } from '../../models/user.model';
import { Metric, MetricStatus, MetricDataType, MetricParentLite, CreateMetricPayload, UpdateMetricPayload } from '../../models/metric.model';
import { MetricFrequency } from '../../models/metric-tracking.model';
import { MetricService } from '../../core/services/metric.service';
import { AuthService } from '../../core/services/auth.service';

export type MetricFormMode = 'create' | 'edit';

// How many trailing periods the Statistics tab's trend chart plots — clamped
// to what's actually available within the metric's current year (and month,
// for daily), since there's no cross-year/cross-month range API yet.
const TREND_POINTS = 10;
const DEFAULT_DECIMAL_POINTS = 2;

interface DataTypeOption {
  value: MetricDataType;
  label: string;
}

const DATA_TYPE_OPTIONS: DataTypeOption[] = [
  { value: 'number', label: 'Default' },
  { value: 'weight', label: 'Weight' },
  { value: 'currency', label: 'Currency' },
  { value: 'percentage', label: 'Percentage' },
];

interface FrequencyOption {
  value: MetricFrequency;
  label: string;
}

// Every frequency with real tracking support in the Bowling View (see
// backend/utils/metricPeriods.ts's FREQUENCY_CONFIG) belongs on this list.
const FREQUENCY_OPTIONS: FrequencyOption[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

@Component({
  selector: 'app-metric-form-modal',
  standalone: true,
  imports: [FormsModule, RouterLink, ModalDirective, ConfirmDialogComponent, DatePickerComponent, CKEditorModule, TabStripComponent, AttachmentsComponent, TrendChartComponent, GaugeChartComponent],
  templateUrl: './metric-form-modal.component.html',
  styleUrl: './metric-form-modal.component.css',
})
export class MetricFormModalComponent implements OnChanges {
  constructor(
    public metricSvc: MetricService,
    private auth: AuthService
  ) {}

  readonly dataTypeOptions = DATA_TYPE_OPTIONS;
  readonly frequencyOptions = FREQUENCY_OPTIONS;
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
  // Frequency to preselect in 'create' mode when there's no `initial` metric
  // to read one from — e.g. the Bowling View passes its active lens, so
  // creating from a filtered lens defaults to that same frequency.
  @Input() defaultFrequency: MetricFrequency | null = null;
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

  @ViewChild('titleInput') titleInput?: ElementRef<HTMLInputElement>;

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
  frequency: MetricFrequency = 'daily';
  localError = '';
  confirmDeleteOpen = false;

  trendCategories: string[] = [];
  trendSeries: TrendChartSeries[] = [];
  trendLoading = false;
  trendError = '';

  // Current-period Actual-vs-Target gauge, shown alongside the trend chart —
  // sourced from the same getTracking() response the trend chart already
  // fetches (its actualTotal/targetTotal), no separate request needed.
  gaugePercent: number | null = null;
  gaugeActual: number | null = null;
  gaugeTarget: number | null = null;

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
      this.frequency = this.initial?.frequency ?? this.defaultFrequency ?? 'daily';
      this.localError = '';
      this.confirmDeleteOpen = false;
      this.activeTab = 'details';
      // Cleared rather than reloaded here — the tab starts on 'details', so
      // stale data from a previously-opened metric would otherwise flash if
      // the user switches to Statistics before a fresh load completes.
      this.trendCategories = [];
      this.trendSeries = [];
      this.trendError = '';
      this.gaugePercent = null;
      this.gaugeActual = null;
      this.gaugeTarget = null;
      // Deferred a tick — the header's title input hasn't rendered yet on
      // this same change-detection pass (the modal's @if (open) block, and
      // the underlying Bootstrap fade-in, haven't necessarily settled).
      setTimeout(() => this.titleInput?.nativeElement.focus());
    }
  }

  setActiveTab(tab: string) {
    this.activeTab = tab;
    if (tab === 'statistics' && this.mode === 'edit' && this.initial) this.loadTrend();
  }

  private loadTrend() {
    const metric = this.initial;
    if (!metric) return;

    const { year, month, period: currentPeriod } = currentPeriodInfo(metric.frequency, new Date());

    this.trendLoading = true;
    this.trendError = '';
    this.metricSvc.getTracking(metric.id, metric.frequency, year, month).subscribe({
      next: (data) => {
        const periodNums = trendWindow(currentPeriod, TREND_POINTS);
        this.trendCategories = periodNums.map((p) => trendPeriodLabel(metric.frequency, p, year));
        this.trendSeries = [
          { name: 'Actual', color: TREND_ACTUAL_COLOR, data: periodNums.map((p) => data.periods[String(p)]?.actual ?? null) },
          { name: 'Target', color: TREND_TARGET_COLOR, data: periodNums.map((p) => data.periods[String(p)]?.target ?? null) },
        ];
        this.trendLoading = false;

        this.gaugeActual = data.actualTotal;
        this.gaugeTarget = data.targetTotal;
        this.gaugePercent = data.targetTotal > 0 ? (data.actualTotal / data.targetTotal) * 100 : null;
      },
      error: (err) => {
        this.trendError = err.error?.message || 'Failed to load trend data';
        this.trendLoading = false;
      },
    });
  }

  // organization is typed loosely (Organization | number | null) since some
  // payloads elsewhere reference it by bare id — currentUser() always
  // carries the full nested object in practice (see authController.ts's
  // toUserShape()), so narrow out the id-only case defensively.
  gaugeValueLabel(value: number | null): string {
    const rawOrg = this.auth.currentUser()?.organization;
    const org = rawOrg && typeof rawOrg === 'object' ? rawOrg : null;
    const decimalPoints = this.auth.currentUser()?.decimalPoints ?? DEFAULT_DECIMAL_POINTS;
    return formatMetricValue(value, this.dataType, org?.currency ?? 'USD', org?.unit ?? 'KG', decimalPoints);
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
      frequency: this.frequency,
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
