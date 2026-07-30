import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, of } from 'rxjs';
import { groupBy, mergeMap, debounceTime, concatMap, tap, catchError } from 'rxjs/operators';
import { cloneDeep, transform, isEqual } from 'lodash-es';
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

// 13 rather than 15 — gives each column more breathing room now that Weekly
// headers show a formatted date (see weekDateLabel) instead of a bare number.
const WINDOW_SIZE = 13;

@Component({
  selector: 'app-metric-bowling',
  standalone: true,
  imports: [FormsModule, MetricFormModalComponent],
  templateUrl: './metric-bowling.component.html',
  styleUrl: './metric-bowling.component.css',
})
export class MetricBowlingComponent implements OnInit {
  @ViewChild('activeInput') activeInputRef?: ElementRef<HTMLInputElement>;

  readonly windowSize = WINDOW_SIZE;

  rows: BowlingRow[] = [];
  loading = false;
  error = '';

  // Flat list of {id, title} for the edit form's "Parent metric" picker —
  // derived from the same active-metrics fetch loadMetrics() already makes,
  // no separate request needed (mirrors MetricsComponent's parentOptions,
  // just sourced from the list this page already loads).
  parentOptions: MetricParentLite[] = [];

  formOpen = false;
  formMode: MetricFormMode = 'edit';
  editingRowIndex: number | null = null;
  formInitial: Metric | null = null;
  formLoading = false;
  formError = '';
  deleteLoading = false;

  // Which frequency's metrics are currently shown — the two lenses have
  // different navigators (Daily: month+day-of-month; Weekly: year+week-of-
  // year) and can't share one header row, so only one is ever visible at a
  // time (see rows filtered by `row.item.frequency === lens` in the template).
  lens: MetricFrequency = 'daily';

  // 'YYYY-MM', bound directly to <input type="month"> — Daily lens only.
  selectedMonthStr = this.defaultMonthStr();
  // Weekly lens only.
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

  // The unit/currency/decimal-places actually shown come from the VIEWING
  // user's own Settings > General preferences, not anything stored on the
  // metric — the metric only picks WHICH of these applies (see dataType).
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

  // Size of the current lens's period axis — days-of-month for Daily,
  // weeks-of-year for Weekly. Everything windowing-related below is driven
  // off this rather than `daysInMonth` directly, so it works for either lens.
  private get periodAxisSize(): number {
    return this.lens === 'daily' ? this.daysInMonth : this.weeksInYear;
  }

  get totalWindows(): number {
    return Math.max(1, Math.ceil(this.periodAxisSize / WINDOW_SIZE));
  }

  get visibleDays(): number[] {
    const start = this.windowIndex * WINDOW_SIZE + 1;
    const end = Math.min(start + WINDOW_SIZE - 1, this.periodAxisSize);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  get windowLabel(): string {
    const days = this.visibleDays;
    const unit = this.lens === 'daily' ? 'Day' : 'Week';
    return days.length === 1 ? `${unit} ${days[0]}` : `${unit}s ${days[0]}–${days[days.length - 1]}`;
  }

  // Whether any loaded metric actually matches the current lens — drives the
  // "switch lens or create one" empty state distinct from "no metrics at all".
  get hasVisibleRows(): boolean {
    return this.rows.some((r) => r.item.frequency === this.lens);
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

  // ISO week-year + week-number of a given date — the inverse of
  // weekStartDate, used only to find "today"'s week so landing on the
  // Weekly lens can jump straight to it instead of always starting at week 1.
  private isoWeekInfo(date: Date): { year: number; week: number } {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayMon1 = d.getUTCDay() || 7; // Mon=1..Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - dayMon1); // Thursday of this ISO week
    const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
    const week = Math.ceil((((d.getTime() - yearStart) / 86_400_000) + 1) / 7);
    return { year: d.getUTCFullYear(), week };
  }

  // Positions the Weekly-lens window on today's ISO week — only when
  // `selectedYear` actually IS the current ISO week-year (there's no
  // "current week" to jump to in a past/future year), falling back to the
  // first window otherwise.
  private jumpToCurrentWeek() {
    const { year, week } = this.isoWeekInfo(new Date());
    this.windowIndex = year === this.selectedYear ? Math.floor((week - 1) / WINDOW_SIZE) : 0;
  }

  setLens(lens: MetricFrequency) {
    if (this.lens === lens) return;
    this.lens = lens;
    if (lens === 'weekly') this.jumpToCurrentWeek();
    else this.windowIndex = 0;
  }

  onMonthChange() {
    this.windowIndex = 0;
    this.loadAllTracking();
  }

  onYearChange() {
    this.jumpToCurrentWeek();
    this.loadAllTracking();
  }

  prevWindow() {
    if (this.windowIndex > 0) this.windowIndex--;
  }

  nextWindow() {
    if (this.windowIndex < this.totalWindows - 1) this.windowIndex++;
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
    if (this.editingRowIndex === null) return;
    const rowIndex = this.editingRowIndex;
    this.formLoading = true;
    this.formError = '';
    this.metricService.updateMetric(this.rows[rowIndex].item.id, payload as UpdateMetricPayload).subscribe({
      next: (res) => {
        this.formLoading = false;
        this.closeForm();
        if (res.metric.status !== 'active') {
          // No longer active — this view only shows active metrics.
          this.rows.splice(rowIndex, 1);
        } else {
          const frequencyChanged = this.rows[rowIndex].item.frequency !== res.metric.frequency;
          this.rows[rowIndex].item = {
            id: res.metric.id,
            sequenceId: res.metric.sequenceId,
            title: res.metric.title,
            department: res.metric.department,
            owner: res.metric.owner,
            status: res.metric.status,
            dataType: res.metric.dataType,
            frequency: res.metric.frequency,
          };
          // The row's already-loaded periods were fetched under the OLD
          // frequency's axis (days vs weeks) — re-fetch under the new one
          // rather than leaving stale/mismatched data in place.
          if (frequencyChanged) this.loadTracking(rowIndex);
        }
        this.parentOptions = this.rows.map((r) => ({ id: r.item.id, title: r.item.title }));
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
        this.parentOptions = this.rows.map((r) => ({ id: r.item.id, title: r.item.title }));
      },
      error: (err) => {
        this.deleteLoading = false;
        this.formError = err.error?.message || 'Failed to delete metric';
      },
    });
  }

  private loadMetrics() {
    this.loading = true;
    this.error = '';
    this.metricService.getMetrics(1, 100, 'active').subscribe({
      next: (res) => {
        this.rows = res.metrics.map((item) => ({
          item,
          periods: {},
          originalPeriods: {},
          actualTotal: 0,
          targetTotal: 0,
          loading: true,
          saving: false,
          error: '',
        }));
        this.parentOptions = res.metrics.map((m) => ({ id: m.id, title: m.title }));
        this.loading = false;
        this.loadAllTracking();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load metrics';
        this.loading = false;
      },
    });
  }

  private loadAllTracking() {
    this.rows.forEach((_, rowIndex) => this.loadTracking(rowIndex));
  }

  // Every row loads regardless of which lens is currently visible (see
  // `lens`) — each metric fetches under its OWN frequency using the
  // matching navigator state (daily rows: year+month from selectedMonthStr;
  // weekly rows: selectedYear, no month), so switching lenses never needs a
  // reload, just a re-filter of already-loaded rows.
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

  // Decimal-formats a raw number per the viewing user's own decimalPoints
  // preference, then decorates it with a unit/symbol per the metric's
  // dataType — the unit itself always comes from the viewer's own currency/
  // unit preference, never anything stored on the metric (no conversion
  // happens either way, this is a label only). Shared by formatRead() (a
  // single day's cell) and formatTotal() (the always-visible Total column).
  private formatValue(value: number, dataType: MetricDataType): string {
    const formatted = value.toFixed(this.decimalPoints);
    switch (dataType) {
      case 'currency': {
        const symbol = CURRENCY_SYMBOLS[this.auth.currentUser()?.currency ?? 'USD'];
        return `${symbol}${formatted}`;
      }
      case 'weight': {
        const symbol = MEASUREMENT_UNIT_SYMBOLS[this.auth.currentUser()?.unit ?? 'KG'];
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

  startEdit(rowIndex: number, row: RowKey, day: number) {
    const current = this.cellValue(rowIndex, row, day);
    this.editing = { rowIndex, row, day };
    // Edit mode shows the raw decimal-formatted number (per the user's
    // decimalPoints preference) but never the unit/currency/% decoration —
    // that only ever appears in read mode.
    this.editValue = current === null ? '' : current.toFixed(this.decimalPoints);
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
    const value = this.editValue.trim() === '' ? null : Number(this.editValue);
    const rowData = this.rows[rowIndex];
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
}
