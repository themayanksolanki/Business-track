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
import { MetricTrackingGridComponent } from '../metric-tracking-grid/metric-tracking-grid.component';
import { currentPeriodInfo } from '../utils/metric-period.util';
import { FREQUENCY_UNIT_ABBR, FREQUENCY_UNIT_LABEL, TREND_ACTUAL_COLOR, TREND_TARGET_COLOR, trendPeriodFullLabel, trendPeriodLabel, trendWindow } from '../utils/metric-trend.util';
import { formatMetricValue, percentOfTarget } from '../utils/metric-value.util';
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
const TREND_POINTS = 13;
const DEFAULT_DECIMAL_POINTS = 2;

interface DataTypeOption {
  value: MetricDataType;
  label: string;
  icon: string;
}

const DATA_TYPE_OPTIONS: DataTypeOption[] = [
  { value: 'number', label: 'Number', icon: 'bi-hash' },
  { value: 'weight', label: 'Weight', icon: 'bi-box-seam' },
  { value: 'currency', label: 'Currency', icon: 'bi-currency-dollar' },
  { value: 'percentage', label: 'Percentage', icon: 'bi-percent' },
];

interface FrequencyOption {
  value: MetricFrequency;
  label: string;
  icon: string;
}

// Every frequency with real tracking support in the Bowling View (see
// backend/utils/metricPeriods.ts's FREQUENCY_CONFIG) belongs on this list.
const FREQUENCY_OPTIONS: FrequencyOption[] = [
  { value: 'daily', label: 'Daily', icon: 'bi-calendar-day' },
  { value: 'weekly', label: 'Weekly', icon: 'bi-calendar-week' },
  { value: 'monthly', label: 'Monthly', icon: 'bi-calendar-month' },
  { value: 'quarterly', label: 'Quarterly', icon: 'bi-calendar3' },
  { value: 'yearly', label: 'Yearly', icon: 'bi-calendar-range' },
];

interface StatusOption {
  value: MetricStatus;
  label: string;
  icon: string;
  color: string;
}

// 'deleted' is never user-selectable from this dropdown (deletion happens
// via the dedicated Delete button/confirm flow) — it's only ever rendered
// as a disabled entry so an already-deleted metric's status still displays
// correctly here.
const STATUS_OPTIONS: StatusOption[] = [
  { value: 'active', label: 'Active', icon: 'bi-check-circle-fill', color: '#22c55e' },
  { value: 'archived', label: 'Archived', icon: 'bi-archive-fill', color: '#f59e0b' },
  { value: 'deleted', label: 'Deleted', icon: 'bi-trash3-fill', color: '#ef4444' },
];

@Component({
  selector: 'app-metric-form-modal',
  standalone: true,
  imports: [FormsModule, RouterLink, ModalDirective, ConfirmDialogComponent, DatePickerComponent, CKEditorModule, TabStripComponent, AttachmentsComponent, TrendChartComponent, GaugeChartComponent, MetricTrackingGridComponent],
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
  readonly statusOptions = STATUS_OPTIONS;
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

  // YTD-ish scope totals (data.actualTotal/targetTotal) — the single ratio
  // that drives the gauge ring, the delta line, the legend rows, and the
  // Achievement meter, so they never show conflicting percentages. (A
  // single current-period lookup was tried and dropped — most metrics
  // haven't had their current period logged yet at any given moment, which
  // degenerated the gauge to a permanent, uninformative 0%.)
  gaugePercent: number | null = null;
  ytdActual: number | null = null;
  ytdTarget: number | null = null;
  achievementDirection: 'ahead' | 'behind' | 'on-target' | null = null;
  achievementDeltaPercent = 0;

  // "Best <period>" + windowed totals — scoped to the same trailing window
  // the trend chart plots (periodNums), not the YTD totals. Null value
  // means nothing tracked in that window (render "—"), not zero.
  bestActualPeriodLabel = '';
  bestActualValue: number | null = null;
  bestTargetPeriodLabel = '';
  bestTargetValue: number | null = null;
  trendTotalActual: number | null = null;
  trendTotalTarget: number | null = null;

  readonly trendActualColor = TREND_ACTUAL_COLOR;
  readonly trendTargetColor = TREND_TARGET_COLOR;

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

  // Lookups backing the Details tab's dropdown triggers — each dropdown
  // stores just the selected id (department/category/owner/parentId), same
  // as the <select>s it replaced, so the trigger button re-derives the
  // full object to render.
  get selectedDepartment(): Department | null {
    return this.departments.find((d) => d.id === this.department) ?? null;
  }

  get selectedCategoryObj(): Category | null {
    return this.category !== null ? (this.categories.find((c) => c.id === this.category) ?? null) : null;
  }

  get selectedOwnerUser(): User | null {
    return this.users.find((u) => u.id === this.owner) ?? null;
  }

  get selectedParent(): MetricParentLite | null {
    return this.parentId !== null ? (this.availableParents.find((m) => m.id === this.parentId) ?? null) : null;
  }

  get selectedDataTypeOption(): DataTypeOption {
    return DATA_TYPE_OPTIONS.find((o) => o.value === this.dataType) ?? DATA_TYPE_OPTIONS[0];
  }

  get selectedFrequencyOption(): FrequencyOption {
    return FREQUENCY_OPTIONS.find((o) => o.value === this.frequency) ?? FREQUENCY_OPTIONS[0];
  }

  get selectedStatusOption(): StatusOption {
    return STATUS_OPTIONS.find((o) => o.value === this.status) ?? STATUS_OPTIONS[0];
  }

  ownerAvatarUrl(user: User): string | null {
    return this.auth.avatarUrl(user);
  }

  selectDepartment(id: number) {
    this.department = id;
  }

  selectCategory(id: number | null) {
    this.category = id;
  }

  selectOwner(id: number) {
    this.owner = id;
  }

  selectParent(id: number | null) {
    this.parentId = id;
  }

  selectDataType(value: MetricDataType) {
    this.dataType = value;
  }

  selectFrequency(value: MetricFrequency) {
    this.frequency = value;
  }

  selectStatus(value: MetricStatus) {
    this.status = value;
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
      // Statistics has nothing to show yet in 'create' mode (no metric id
      // to fetch tracking data for) — default to Details there instead.
      this.activeTab = this.mode === 'edit' ? 'statistics' : 'details';
      // Cleared before the fresh load below kicks off, so stale data from a
      // previously-opened metric can't flash while the new request is in
      // flight.
      this.trendCategories = [];
      this.trendSeries = [];
      this.trendError = '';
      this.gaugePercent = null;
      this.ytdActual = null;
      this.ytdTarget = null;
      this.achievementDirection = null;
      this.achievementDeltaPercent = 0;
      this.bestActualPeriodLabel = '';
      this.bestActualValue = null;
      this.bestTargetPeriodLabel = '';
      this.bestTargetValue = null;
      this.trendTotalActual = null;
      this.trendTotalTarget = null;
      // Statistics is now the default-open tab, so its data has to load
      // eagerly here — setActiveTab()'s lazy load only fires on a later
      // tab *switch*, which never happens if the user never leaves it.
      if (this.mode === 'edit' && this.initial) this.loadTrend();
    }
  }

  // Bound to the modal element's `shown.bs.modal` event rather than run
  // from ngOnChanges: Bootstrap's own Modal (see modal.service.ts's
  // `focus: true`) grabs focus for itself once its fade-in transition
  // finishes, which happens after ngOnChanges — an early focus() call there
  // just gets stolen back. `shown.bs.modal` fires right after Bootstrap's
  // own focus grab, so calling focus() here reliably wins.
  focusTitleInput() {
    this.titleInput?.nativeElement.focus();
  }

  setActiveTab(tab: string) {
    this.activeTab = tab;
    if (tab === 'statistics' && this.mode === 'edit' && this.initial) this.loadTrend();
  }

  // Not private — also called directly from the Statistics tab's tracking
  // grid (saved) output, so an edit there refreshes the gauge/YTD totals/
  // trend chart without a page reload.
  loadTrend() {
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

        // Gauge + delta + legend + Achievement meter all read the same YTD
        // scope-total ratio, so they never show conflicting percentages.
        this.ytdActual = data.actualTotal;
        this.ytdTarget = data.targetTotal;
        this.gaugePercent = percentOfTarget(data.actualTotal, data.targetTotal);
        if (this.gaugePercent === null) {
          this.achievementDirection = null;
          this.achievementDeltaPercent = 0;
        } else {
          const diff = Math.round(this.gaugePercent) - 100;
          this.achievementDirection = diff > 0 ? 'ahead' : diff < 0 ? 'behind' : 'on-target';
          this.achievementDeltaPercent = Math.abs(diff);
        }

        // Best period + window totals — scoped to periodNums, skip nulls.
        let bestActualPeriod: number | null = null;
        let bestActualValue: number | null = null;
        let bestTargetPeriod: number | null = null;
        let bestTargetValue: number | null = null;
        let totalActual: number | null = null;
        let totalTarget: number | null = null;

        for (const p of periodNums) {
          const entry = data.periods[String(p)];
          if (entry?.actual != null) {
            totalActual = (totalActual ?? 0) + entry.actual;
            if (bestActualValue === null || entry.actual > bestActualValue) {
              bestActualValue = entry.actual;
              bestActualPeriod = p;
            }
          }
          if (entry?.target != null) {
            totalTarget = (totalTarget ?? 0) + entry.target;
            if (bestTargetValue === null || entry.target > bestTargetValue) {
              bestTargetValue = entry.target;
              bestTargetPeriod = p;
            }
          }
        }

        this.bestActualValue = bestActualValue;
        this.bestTargetValue = bestTargetValue;
        this.bestActualPeriodLabel = bestActualPeriod !== null ? trendPeriodFullLabel(metric.frequency, bestActualPeriod, year) : '';
        this.bestTargetPeriodLabel = bestTargetPeriod !== null ? trendPeriodFullLabel(metric.frequency, bestTargetPeriod, year) : '';
        this.trendTotalActual = totalActual;
        this.trendTotalTarget = totalTarget;
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

  get frequencyUnitLabel(): string {
    return this.initial ? FREQUENCY_UNIT_LABEL[this.initial.frequency] : '';
  }

  get frequencyUnitAbbr(): string {
    return this.initial ? FREQUENCY_UNIT_ABBR[this.initial.frequency] : '';
  }

  // Meter fill visually caps an exceeded goal at 100%; the true (possibly
  // >100) percent still shows as text next to it.
  get achievementMeterWidth(): number {
    return this.gaugePercent === null ? 0 : Math.min(100, Math.max(0, this.gaugePercent));
  }

  get achievementPercentRounded(): number {
    return this.gaugePercent === null ? 0 : Math.max(0, Math.round(this.gaugePercent));
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
