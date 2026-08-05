import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, of } from 'rxjs';
import { groupBy, mergeMap, debounceTime, concatMap, tap, catchError } from 'rxjs/operators';
import { cloneDeep, debounce, transform, isEqual } from 'lodash-es';
import { MetricService } from '../../core/services/metric.service';
import { AuthService } from '../../core/services/auth.service';
import { DateFormatService } from '../../core/services/date-format.service';
import { DepartmentService } from '../../core/services/department.service';
import { CategoryService } from '../../core/services/category.service';
import { UserService } from '../../core/services/user.service';
import {
  Metric,
  MetricListItem,
  MetricDataType,
  MetricParentLite,
  CreateMetricPayload,
  UpdateMetricPayload,
} from '../../models/metric.model';
import { MetricFrequency, PeriodMap, PeriodValue, TrackingDiff } from '../../models/metric-tracking.model';
import { CURRENCY_SYMBOLS, MEASUREMENT_UNIT_SYMBOLS } from '../../models/user.model';
import { MetricFormModalComponent, MetricFormMode } from '../../shared/metric-form-modal/metric-form-modal.component';
import { MONTH_LABELS, isoWeekInfo } from '../../shared/utils/metric-period.util';
import { canEditMetricListItem, STATUS_COLORS } from '../../shared/utils/metric-value.util';
import { FrequencyIconComponent, FrequencyIconName } from '../../shared/frequency-icon/frequency-icon.component';
import { NgbPopover } from '@ng-bootstrap/ng-bootstrap';
import { MetricInfoPopoverComponent } from '../../shared/metric-info-popover/metric-info-popover.component';

const DEFAULT_DECIMAL_POINTS = 2;

type RowKey = 'actual' | 'target';

interface CellCoord {
  rowIndex: number;
  row: RowKey;
  day: number;
}

interface BowlingRow {
  item: MetricListItem;
  periods: PeriodMap;
  // Pristine snapshot taken right after load/save — the base a lodash deep
  // diff is computed against, so only genuinely-changed days get sent.
  originalPeriods: PeriodMap;
  actualTotal: number;
  targetTotal: number;
  loading: boolean;
  saving: boolean;
  error: string;
}

// Daily lens pages through the month 15 days at a time.
const DAILY_WINDOW_SIZE = 15;

// Weekly lens pages by calendar quarter rather than a flat 13-week chunk —
// Q1-Q3 are always weeks 1-13/14-26/27-39; Q4 picks up whatever's left
// (13 weeks normally, 14 in a 53-week ISO year) instead of spilling into a
// tiny 5th window. 1-indexed week numbers, matching weekDateLabel/visibleDays.
const WEEKLY_QUARTER_STARTS = [1, 14, 27, 40];

// Labels for the lens toggle / page subtitle / empty state — only the
// implemented lenses are ever set on `lens`, but MetricFrequency's other
// values are covered too so this stays a total function.
const LENS_LABELS: Record<MetricFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

// Order shown in the lens dropdown — only the frequencies the Bowling View
// actually implements (see backend/utils/metricPeriods.ts's FREQUENCY_CONFIG).
const IMPLEMENTED_LENSES: FrequencyIconName[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

// Yearly shows this many consecutive years at once (periods 1..N), starting
// at whatever `selectedYear` is typed in — mirrors backend/utils/
// metricPeriods.ts's yearly periodCount().
const YEARLY_BLOCK_SIZE = 5;

@Component({
  selector: 'app-metric-bowling',
  standalone: true,
  imports: [FormsModule, MetricFormModalComponent, FrequencyIconComponent, NgbPopover, MetricInfoPopoverComponent],
  templateUrl: './metric-bowling.component.html',
  styleUrl: './metric-bowling.component.css',
})
export class MetricBowlingComponent implements OnInit, OnDestroy {
  @ViewChild('activeInput') activeInputRef?: ElementRef<HTMLInputElement>;

  rows: BowlingRow[] = [];
  loading = false;
  error = '';

  // Server-side, case-insensitive partial-or-full title match — same
  // debounced-350ms/lodash convention as MetricsComponent's own search, just
  // triggering loadMetrics() (this page's per-lens combined fetch) instead
  // of a plain paginated list reload.
  search = '';
  private readonly debouncedSearch = debounce(() => this.loadMetrics(), 350);

  // Flat list of {id, title} for the edit form's "Parent metric" picker —
  // a metric can parent one of any frequency, so unlike loadMetrics() (now
  // scoped to a single lens) this is its own small fetch of every active
  // metric, refreshed after create/update/delete rather than derived from
  // `rows` (mirrors MetricsComponent's own loadParentOptions).
  parentOptions: MetricParentLite[] = [];

  formOpen = false;
  formMode: MetricFormMode = 'edit';
  editingRowIndex: number | null = null;
  formInitial: Metric | null = null;
  formLoading = false;
  formError = '';
  deleteLoading = false;

  // Which lenses to offer, in order, and their labels — exposed for the
  // template's dropdown @for loop.
  readonly lensOptions = IMPLEMENTED_LENSES;
  readonly lensLabels = LENS_LABELS;

  // Which frequency's metrics are currently shown — the lenses have
  // different navigators (Daily: month+day-of-month; Weekly: year+week-of-
  // year; Monthly: year+month-of-year; Quarterly: year+quarter-of-year;
  // Yearly: start-year+year-of-block) and can't share one header row.
  // `rows` only ever holds this lens's metrics (loadMetrics() fetches
  // exactly one frequency at a time — see MetricService.getBowlingMetrics),
  // so switching lenses reloads rather than re-filtering a mixed batch.
  lens: FrequencyIconName = 'monthly';

  // 'YYYY-MM', bound directly to <input type="month"> — Daily lens only.
  selectedMonthStr = this.defaultMonthStr();
  // Weekly, Monthly, Quarterly, and Yearly lenses — for Yearly this is the
  // block's start year, not "the" year (see YEARLY_BLOCK_SIZE).
  selectedYear = new Date().getFullYear();
  windowIndex = 0;

  editing: CellCoord | null = null;
  editValue = '';
  editError = '';

  // Captures {rowIndex, frequency, year, month} at the moment of the edit
  // (not read fresh when the debounce flushes) — otherwise switching the
  // month/year picker within the 500ms debounce window would save against
  // the NEW period instead of the one the edit was actually made in.
  private readonly saveTrigger = new Subject<{ rowIndex: number; frequency: MetricFrequency; year: number; month: number | null }>();

  constructor(
    private metricService: MetricService,
    public auth: AuthService,
    public departmentService: DepartmentService,
    public categoryService: CategoryService,
    public userService: UserService,
    public dateFormat: DateFormatService
  ) {}

  // Decimal places shown come from the VIEWING user's own Settings > General
  // preference. Currency/measurement-unit symbols, by contrast, come from
  // the organization (fixed at signup, same for everyone in it — see
  // Organization.currency/.unit) — the metric only picks WHICH of these
  // applies (see dataType).
  private get decimalPoints(): number {
    return this.auth.currentUser()?.decimalPoints ?? DEFAULT_DECIMAL_POINTS;
  }

  ngOnInit() {
    this.saveTrigger
      .pipe(
        groupBy((t) => t.rowIndex),
        mergeMap((group$) => group$.pipe(debounceTime(500), concatMap((t) => this.doSave(t.rowIndex, t.frequency, t.year, t.month))))
      )
      .subscribe();

    this.departmentService.ensureDepartmentsLoaded();
    this.categoryService.ensureCategoriesLoaded();
    this.userService.ensureUsersLoaded();
    this.loadMetrics();
    this.loadParentOptions();
  }

  ngOnDestroy() {
    this.debouncedSearch.cancel();
  }

  onSearchChange() {
    this.debouncedSearch();
  }

  private defaultMonthStr(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  get year(): number {
    return Number(this.selectedMonthStr.split('-')[0]);
  }

  get month(): number {
    return Number(this.selectedMonthStr.split('-')[1]);
  }

  get daysInMonth(): number {
    return new Date(this.year, this.month, 0).getDate();
  }

  // ISO 8601: a year has 53 weeks iff Jan 1 falls on a Thursday, or it's a
  // leap year and Jan 1 falls on a Wednesday — mirrors backend/utils/
  // metricPeriods.ts's isoWeeksInYear so client-side windowing agrees with
  // what the server will actually accept.
  get weeksInYear(): number {
    const year = this.selectedYear;
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const jan1Day = new Date(year, 0, 1).getDay();
    if (jan1Day === 4) return 53;
    if (jan1Day === 3 && isLeap) return 53;
    return 52;
  }

  // [start, end] (1-indexed, inclusive) of a given quarter's weeks — Q4 runs
  // to the end of the ISO year, so it's 13 weeks in a 52-week year and 14 in
  // a 53-week one, rather than a fixed size like Q1-Q3.
  private weeklyQuarterRange(quarterIndex: number): [number, number] {
    const start = WEEKLY_QUARTER_STARTS[quarterIndex];
    const end = quarterIndex < 3 ? WEEKLY_QUARTER_STARTS[quarterIndex + 1] - 1 : this.weeksInYear;
    return [start, end];
  }

  get totalWindows(): number {
    if (this.lens === 'monthly' || this.lens === 'quarterly' || this.lens === 'yearly') return 1;
    if (this.lens === 'weekly') return WEEKLY_QUARTER_STARTS.length;
    return Math.max(1, Math.ceil(this.daysInMonth / DAILY_WINDOW_SIZE));
  }

  get visibleDays(): number[] {
    if (this.lens === 'monthly') return Array.from({ length: 12 }, (_, i) => i + 1);
    if (this.lens === 'quarterly') return [1, 2, 3, 4];
    if (this.lens === 'yearly') return Array.from({ length: YEARLY_BLOCK_SIZE }, (_, i) => i + 1);
    if (this.lens === 'weekly') {
      const [start, end] = this.weeklyQuarterRange(this.windowIndex);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    const start = this.windowIndex * DAILY_WINDOW_SIZE + 1;
    const end = Math.min(start + DAILY_WINDOW_SIZE - 1, this.daysInMonth);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  get windowLabel(): string {
    const days = this.visibleDays;
    if (this.lens === 'yearly') return `${this.selectedYear}–${this.selectedYear + YEARLY_BLOCK_SIZE - 1}`;
    if (this.lens === 'monthly' || this.lens === 'quarterly') return String(this.selectedYear);
    if (this.lens === 'weekly') {
      const range = days.length === 1 ? `Week ${days[0]}` : `Weeks ${days[0]}–${days[days.length - 1]}`;
      return `Q${this.windowIndex + 1} · ${range}`;
    }
    return days.length === 1 ? `Day ${days[0]}` : `Days ${days[0]}–${days[days.length - 1]}`;
  }

  // Page subtitle / empty-state lens name.
  get lensLabel(): string {
    return LENS_LABELS[this.lens];
  }

  // Prev/Next window button text — what one "page" of the active lens is.
  get navUnitLabel(): string {
    if (this.lens === 'yearly') return `${YEARLY_BLOCK_SIZE} Years`;
    if (this.lens === 'monthly' || this.lens === 'quarterly') return 'Year';
    if (this.lens === 'weekly') return 'Quarter';
    return `${DAILY_WINDOW_SIZE} Days`;
  }

  // Monday of ISO week `week` in `selectedYear` — Jan 4th always falls in
  // week 1 (ISO 8601), so week 1's Monday is Jan 4th walked back to the
  // Monday of its own week; every other week is just +7 days from there.
  private weekStartDate(week: number): Date {
    const jan4 = new Date(this.selectedYear, 0, 4);
    const jan4DayMon1 = jan4.getDay() || 7; // Mon=1..Sun=7
    const week1Monday = new Date(this.selectedYear, 0, 4 - (jan4DayMon1 - 1));
    return new Date(week1Monday.getFullYear(), week1Monday.getMonth(), week1Monday.getDate() + (week - 1) * 7);
  }

  // Column header label for a Weekly-lens period — the week's Monday,
  // rendered in the viewing user's own date format (see DateFormatService),
  // not a bare week number.
  weekDateLabel(week: number): string {
    return this.dateFormat.formatDate(this.weekStartDate(week));
  }

  monthLabel(month: number): string {
    return MONTH_LABELS[month - 1];
  }

  quarterLabel(quarter: number): string {
    return `Q${quarter}`;
  }

  // Yearly-lens period 1..N maps to the actual calendar year it represents
  // (selectedYear is the block's start year — see YEARLY_BLOCK_SIZE).
  yearLabel(period: number): string {
    return String(this.selectedYear + period - 1);
  }

  // Column header content for a period, dispatched by the active lens —
  // Daily shows the raw day-of-month, Weekly the week's Monday, Monthly the
  // month name, Quarterly "Q1".."Q4", Yearly the actual calendar year.
  columnLabel(period: number): string {
    if (this.lens === 'daily') return String(period);
    if (this.lens === 'weekly') return this.weekDateLabel(period);
    if (this.lens === 'quarterly') return this.quarterLabel(period);
    if (this.lens === 'yearly') return this.yearLabel(period);
    return this.monthLabel(period);
  }

  // Which quarter window (0-3) a given ISO week falls into.
  private quarterIndexForWeek(week: number): number {
    let index = 0;
    while (index < WEEKLY_QUARTER_STARTS.length - 1 && week >= WEEKLY_QUARTER_STARTS[index + 1]) index++;
    return index;
  }

  // Positions the Weekly-lens window on today's ISO week — only when
  // `selectedYear` actually IS the current ISO week-year (there's no
  // "current week" to jump to in a past/future year), falling back to the
  // first window otherwise.
  private jumpToCurrentWeek() {
    const { year, week } = isoWeekInfo(new Date());
    this.windowIndex = year === this.selectedYear ? this.quarterIndexForWeek(week) : 0;
  }

  setLens(lens: FrequencyIconName) {
    if (this.lens === lens) return;
    this.lens = lens;
    if (lens === 'weekly') this.jumpToCurrentWeek();
    else this.windowIndex = 0;
    // rows only ever holds one lens's metrics now (see loadMetrics) — a
    // switch needs a fresh fetch, not a re-filter of an already-loaded batch.
    this.loadMetrics();
  }

  onMonthChange() {
    this.windowIndex = 0;
    this.loadAllTracking();
  }

  onYearChange() {
    if (this.lens === 'weekly') this.jumpToCurrentWeek();
    else this.windowIndex = 0;
    this.loadAllTracking();
  }

  prevWindow() {
    if (this.windowIndex > 0) this.windowIndex--;
  }

  nextWindow() {
    if (this.windowIndex < this.totalWindows - 1) this.windowIndex++;
  }

  openCreate() {
    this.formMode = 'create';
    this.editingRowIndex = null;
    this.formInitial = null;
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(rowIndex: number) {
    this.editingRowIndex = rowIndex;
    this.formError = '';
    this.metricService.getMetricById(this.rows[rowIndex].item.id).subscribe({
      next: (metric) => {
        this.formMode = 'edit';
        this.formInitial = metric;
        this.formOpen = true;
      },
      error: (err) => (this.error = err.error?.message || 'Failed to load metric'),
    });
  }

  closeForm() {
    this.formOpen = false;
    this.formError = '';
  }

  submitForm(payload: CreateMetricPayload | UpdateMetricPayload) {
    this.formLoading = true;
    this.formError = '';

    if (this.formMode === 'create') {
      this.metricService.createMetric(payload as CreateMetricPayload).subscribe({
        next: (res) => {
          this.formLoading = false;
          this.closeForm();
          // The form defaults to the current lens ([defaultFrequency]="lens"
          // in the template) but the user can still change it before
          // submitting — only add the row if it actually belongs on THIS
          // lens's now-scoped `rows`; otherwise it exists, just under a
          // different lens the user isn't currently viewing.
          if (res.metric.frequency === this.lens) {
            const item: MetricListItem = {
              id: res.metric.id,
              sequenceId: res.metric.sequenceId,
              title: res.metric.title,
              department: res.metric.department,
              category: res.metric.category,
              owner: res.metric.owner,
              status: res.metric.status,
              dataType: res.metric.dataType,
              frequency: res.metric.frequency,
              isLocked: res.metric.isLocked,
              members: res.metric.members?.map((m) => ({ userId: m.user.id, role: m.role })),
            };
            this.rows.push({
              item,
              periods: {},
              originalPeriods: {},
              actualTotal: 0,
              targetTotal: 0,
              loading: true,
              saving: false,
              error: '',
            });
            this.loadTracking(this.rows.length - 1);
          }
          this.loadParentOptions();
        },
        error: (err) => {
          this.formError = err.error?.message || 'Failed to save metric';
          this.formLoading = false;
        },
      });
      return;
    }

    if (this.editingRowIndex === null) return;
    const rowIndex = this.editingRowIndex;
    this.metricService.updateMetric(this.rows[rowIndex].item.id, payload as UpdateMetricPayload).subscribe({
      next: (res) => {
        this.formLoading = false;
        this.closeForm();
        // No longer active, or its frequency moved it out of the lens
        // currently being viewed — either way it no longer belongs in
        // `rows`. Otherwise its frequency (hence periods' day/week/etc.
        // axis) is unchanged, so there's nothing to re-fetch.
        if (res.metric.status !== 'active' || res.metric.frequency !== this.lens) {
          this.rows.splice(rowIndex, 1);
        } else {
          this.rows[rowIndex].item = {
            id: res.metric.id,
            sequenceId: res.metric.sequenceId,
            title: res.metric.title,
            department: res.metric.department,
            category: res.metric.category,
            owner: res.metric.owner,
            status: res.metric.status,
            dataType: res.metric.dataType,
            frequency: res.metric.frequency,
            isLocked: res.metric.isLocked,
            members: res.metric.members?.map((m) => ({ userId: m.user.id, role: m.role })),
          };
        }
        this.loadParentOptions();
      },
      error: (err) => {
        this.formError = err.error?.message || 'Failed to save metric';
        this.formLoading = false;
      },
    });
  }

  onDeleteConfirmed() {
    if (this.editingRowIndex === null) return;
    const rowIndex = this.editingRowIndex;
    this.deleteLoading = true;
    this.metricService.updateMetric(this.rows[rowIndex].item.id, { status: 'deleted' }).subscribe({
      next: () => {
        this.deleteLoading = false;
        this.closeForm();
        this.rows.splice(rowIndex, 1);
        this.loadParentOptions();
      },
      error: (err) => {
        this.deleteLoading = false;
        this.formError = err.error?.message || 'Failed to delete metric';
      },
    });
  }

  // Scoped to exactly one lens per call — the currently active `lens`, plus
  // its own year/month (daily: selectedMonthStr's year+month; everything
  // else: selectedYear, no month) and the current search text. Switching
  // lens/year/month/search all re-call this rather than filtering an
  // already-loaded everything-batch (see MetricService.getBowlingMetrics).
  private loadMetrics() {
    this.loading = true;
    this.error = '';
    const year = this.lens === 'daily' ? this.year : this.selectedYear;
    const month = this.lens === 'daily' ? this.month : null;
    this.metricService.getBowlingMetrics(this.lens, year, month, this.search).subscribe({
      next: (res) => {
        this.rows = res.metrics.map(({ tracking, ...item }) => ({
          item,
          periods: tracking.periods,
          originalPeriods: cloneDeep(tracking.periods),
          actualTotal: tracking.actualTotal,
          targetTotal: tracking.targetTotal,
          loading: false,
          saving: false,
          error: '',
        }));
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load metrics';
        this.loading = false;
      },
    });
  }

  // A metric can parent one of any frequency, so this deliberately loads
  // every active metric regardless of the current lens/search — independent
  // of loadMetrics() above, refreshed after create/update/delete instead of
  // derived from `rows`.
  private loadParentOptions() {
    this.metricService.getMetrics(1, 100, 'active').subscribe({
      next: (res) => (this.parentOptions = res.metrics.map((m) => ({ id: m.id, title: m.title }))),
      error: () => {},
    });
  }

  private loadAllTracking() {
    this.rows.forEach((_, rowIndex) => this.loadTracking(rowIndex));
  }

  // Refreshes one row's tracking under its own frequency's matching
  // navigator state (daily rows: year+month from selectedMonthStr;
  // everything else: selectedYear, no month) — used by onMonthChange/
  // onYearChange (every currently-loaded row already shares the active
  // lens) and by submitForm/openEdit for a single just-created/edited row.
  private loadTracking(rowIndex: number) {
    const row = this.rows[rowIndex];
    row.loading = true;
    row.error = '';
    const frequency = row.item.frequency;
    const year = frequency === 'daily' ? this.year : this.selectedYear;
    const month = frequency === 'daily' ? this.month : null;
    this.metricService.getTracking(row.item.id, frequency, year, month).subscribe({
      next: (data) => {
        row.periods = data.periods;
        row.originalPeriods = cloneDeep(data.periods);
        row.actualTotal = data.actualTotal;
        row.targetTotal = data.targetTotal;
        row.loading = false;
      },
      error: (err) => {
        row.error = err.error?.message || 'Failed to load tracking data';
        row.loading = false;
      },
    });
  }

  cellValue(rowIndex: number, row: RowKey, day: number): number | null {
    return this.rows[rowIndex].periods[String(day)]?.[row] ?? null;
  }

  // Same RAG status a period may carry from the Sheet tab (status is only
  // ever derived/saved there — see calculateRagStatus in metric-value.util —
  // Bowling never computes or edits it, just reflects whatever's already on
  // the period). Reused on the Actual cell only, mirroring the Sheet tab's
  // own Status column being keyed off Actual against lowest/medium/upper.
  actualCellStatusColor(rowIndex: number, day: number): string | null {
    const status = this.rows[rowIndex].periods[String(day)]?.status;
    return status ? STATUS_COLORS[status] : null;
  }

  // Decimal-formats a raw number per the viewing user's own decimalPoints
  // preference, then decorates it with a unit/symbol per the metric's
  // dataType — the symbol itself always comes from the organization's fixed
  // currency/unit (same for every viewer in the org, never anything stored
  // on the metric itself; no conversion happens either way, this is a label
  // only). Shared by formatRead() (a single day's cell) and formatTotal()
  // (the always-visible Total column).
  private formatValue(value: number, dataType: MetricDataType): string {
    const formatted = value.toFixed(this.decimalPoints);
    // organization is typed loosely (Organization | number | null) since
    // some payloads elsewhere reference it by bare id — currentUser() always
    // carries the full nested object in practice (see authController.ts's
    // toUserShape()), so narrow out the id-only case defensively.
    const rawOrg = this.auth.currentUser()?.organization;
    const org = rawOrg && typeof rawOrg === 'object' ? rawOrg : null;
    switch (dataType) {
      case 'currency': {
        const symbol = CURRENCY_SYMBOLS[org?.currency ?? 'USD'];
        return `${symbol}${formatted}`;
      }
      case 'weight': {
        const symbol = MEASUREMENT_UNIT_SYMBOLS[org?.unit ?? 'KG'];
        return `${formatted} ${symbol}`;
      }
      case 'percentage':
        return `${formatted}%`;
      default:
        return formatted;
    }
  }

  formatRead(rowIndex: number, row: RowKey, day: number): string {
    const value = this.cellValue(rowIndex, row, day);
    if (value === null) return '';
    return this.formatValue(value, this.rows[rowIndex].item.dataType);
  }

  formatTotal(rowIndex: number, row: RowKey): string {
    const rowData = this.rows[rowIndex];
    const value = row === 'actual' ? rowData.actualTotal : rowData.targetTotal;
    return this.formatValue(value, rowData.item.dataType);
  }

  isEditing(rowIndex: number, row: RowKey, day: number): boolean {
    return !!this.editing && this.editing.rowIndex === rowIndex && this.editing.row === row && this.editing.day === day;
  }

  // Percentage metrics are stored/read in percentage-point scale (a stored
  // 70 means "70%", read straight through by formatValue's plain `${n}%` —
  // no scaling there). Typing is friendlier as a fraction though (spreadsheet
  // convention: 0.7 means 70%), so the edit box shows/accepts the /100 form
  // and converts back with *100 on commit. Every other dataType passes
  // through unchanged.
  private toEditValue(stored: number, dataType: MetricDataType): number {
    return dataType === 'percentage' ? stored / 100 : stored;
  }

  private fromEditValue(entered: number, dataType: MetricDataType): number {
    return dataType === 'percentage' ? entered * 100 : entered;
  }

  // A Viewer on this specific metric's team can't enter its Bowling View
  // cells — mirrors the metric-form-modal's own canEditMetric gate, just
  // per-row since this page shows many metrics at once. A locked metric
  // blocks everyone, including whoever would otherwise pass
  // canEditMetricListItem — see metric-value.util.ts's canLockMetricListItem
  // for who may lock/unlock it (shown as a small lock icon next to the
  // metric name below, see metric-bowling.component.html).
  canEditRow(row: BowlingRow): boolean {
    return !row.item.isLocked && canEditMetricListItem(this.auth.currentUser(), row.item);
  }

  startEdit(rowIndex: number, row: RowKey, day: number) {
    if (!this.canEditRow(this.rows[rowIndex])) return;
    const current = this.cellValue(rowIndex, row, day);
    this.editing = { rowIndex, row, day };
    const dataType = this.rows[rowIndex].item.dataType;
    if (current === null) {
      this.editValue = '';
    } else if (dataType === 'percentage') {
      // Not toFixed(decimalPoints) here — that preference is about
      // currency/weight display precision, not fraction precision, and
      // would round e.g. 0.705 down to "1" for a user with 0 decimal points.
      // JS's own number-to-string already gives the shortest round-tripping
      // decimal (70/100 -> "0.7", not a binary-float artifact).
      this.editValue = String(this.toEditValue(current, dataType));
    } else {
      this.editValue = current.toFixed(this.decimalPoints);
    }
    this.editError = '';
    setTimeout(() => {
      this.activeInputRef?.nativeElement.focus();
      this.activeInputRef?.nativeElement.select();
    });
  }

  private isValidRaw(raw: string): boolean {
    const trimmed = raw.trim();
    return trimmed === '' || /^-?\d+(\.\d+)?$/.test(trimmed);
  }

  // Applies the in-progress edit to local state (and queues a save) without
  // touching `editing` — the caller decides what happens to edit-mode next.
  // Returns false (leaving the cell in edit mode) if the value is invalid.
  private applyCurrentEdit(): boolean {
    if (!this.editing) return true;
    if (!this.isValidRaw(this.editValue)) {
      this.editError = 'Enter a number';
      return false;
    }
    const { rowIndex, row, day } = this.editing;
    const rowData = this.rows[rowIndex];
    const value = this.editValue.trim() === '' ? null : this.fromEditValue(Number(this.editValue), rowData.item.dataType);
    const key = String(day);
    const existing: PeriodValue = rowData.periods[key] ?? { actual: null, target: null };
    rowData.periods = { ...rowData.periods, [key]: { ...existing, [row]: value } };
    rowData.actualTotal = this.sumField(rowData.periods, 'actual');
    rowData.targetTotal = this.sumField(rowData.periods, 'target');
    const frequency = rowData.item.frequency;
    const year = frequency === 'daily' ? this.year : this.selectedYear;
    const saveMonth = frequency === 'daily' ? this.month : null;
    this.saveTrigger.next({ rowIndex, frequency, year, month: saveMonth });
    return true;
  }

  private sumField(periods: PeriodMap, field: RowKey): number {
    return Object.values(periods).reduce((sum, p) => sum + (typeof p[field] === 'number' ? (p[field] as number) : 0), 0);
  }

  onCellKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        if (this.applyCurrentEdit()) {
          this.editing = null;
          this.editError = '';
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.editing = null;
        this.editError = '';
        break;
      case 'Tab':
        event.preventDefault();
        this.moveTab(event.shiftKey);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.moveArrow(-1, 0);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.moveArrow(1, 0);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        event.preventDefault();
        this.moveArrow(0, 1);
        break;
    }
  }

  // Tab order: this row's whole Actual line left-to-right, then its whole
  // Target line left-to-right, then the next metric's Actual/Target lines —
  // i.e. every currently-visible cell on the page, in reading order.
  private get flatCellOrder(): CellCoord[] {
    const order: CellCoord[] = [];
    this.rows.forEach((rowData, rowIndex) => {
      // Skip rows hidden under the other lens — they're not on screen, so
      // Tab shouldn't land in them.
      if (rowData.item.frequency !== this.lens) return;
      (['actual', 'target'] as RowKey[]).forEach((row) => {
        this.visibleDays.forEach((day) => order.push({ rowIndex, row, day }));
      });
    });
    return order;
  }

  private moveTab(backwards: boolean) {
    if (!this.editing) return;
    if (!this.applyCurrentEdit()) return;
    const current = this.editing;
    this.editing = null;
    const order = this.flatCellOrder;
    const idx = order.findIndex((c) => c.rowIndex === current.rowIndex && c.row === current.row && c.day === current.day);
    const nextIdx = idx + (backwards ? -1 : 1);
    if (nextIdx >= 0 && nextIdx < order.length) {
      const next = order[nextIdx];
      this.startEdit(next.rowIndex, next.row, next.day);
    }
  }

  // Covers clicking away from a cell entirely (not Tab/Escape/arrows, which
  // are already handled in onCellKeydown) — commits like Enter would.
  onCellBlur() {
    if (!this.editing) return;
    if (this.applyCurrentEdit()) {
      this.editing = null;
      this.editError = '';
    }
  }

  private moveArrow(dayDelta: number, rowToggle: number) {
    if (!this.editing) return;
    if (!this.applyCurrentEdit()) return;
    const { rowIndex } = this.editing;
    let { row, day } = this.editing;
    this.editing = null;
    if (dayDelta !== 0) day += dayDelta;
    if (rowToggle !== 0) row = row === 'actual' ? 'target' : 'actual';

    const days = this.visibleDays;
    if (day < days[0] || day > days[days.length - 1]) return; // out of the visible window — just exit edit mode
    this.startEdit(rowIndex, row, day);
  }

  private computeDiff(original: PeriodMap, current: PeriodMap): TrackingDiff {
    return transform(
      current,
      (result: TrackingDiff, value, key) => {
        if (!isEqual(value, original[key])) result[key] = value;
      },
      {} as TrackingDiff
    );
  }

  private doSave(rowIndex: number, frequency: MetricFrequency, year: number, month: number | null) {
    const rowData = this.rows[rowIndex];
    const diff = this.computeDiff(rowData.originalPeriods, rowData.periods);
    if (Object.keys(diff).length === 0) return of(null);

    rowData.saving = true;
    rowData.error = '';
    return this.metricService.saveTrackingDiff(rowData.item.id, frequency, year, month, diff).pipe(
      tap((res) => {
        rowData.originalPeriods = cloneDeep(rowData.periods);
        rowData.actualTotal = res.actualTotal;
        rowData.targetTotal = res.targetTotal;
        rowData.saving = false;
      }),
      catchError((err) => {
        rowData.saving = false;
        rowData.error = err.error?.message || 'Failed to save';
        return of(null);
      })
    );
  }

  showMetricInfoCardHtml(row: MetricListItem) {
    // show title, category, department, owner, frequency, dataType, and status in a popover card — mirrors MetricsComponent's info card, but this page doesn't
    return `<div class="metric-info-card">
      <div><strong>Title:</strong> ${row.title}</div>
      <div><strong>Category:</strong> ${row.category?.name || 'N/A'}</div>
      <div><strong>Department:</strong> ${row.department?.name || 'N/A'}</div>
      <div><strong>Owner:</strong> ${row.owner?.username || 'N/A'}</div>
      <div><strong>Frequency:</strong> ${row.frequency}</div>
      <div><strong>Data Type:</strong> ${row.dataType}</div>
      <div><strong>Status:</strong> ${row.status}</div>
    </div>`;
  }
}
