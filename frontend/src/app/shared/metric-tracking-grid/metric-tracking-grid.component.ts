import { Component, ElementRef, Input, OnChanges, OnDestroy, Output, EventEmitter, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, of } from 'rxjs';
import { debounceTime, concatMap, tap, catchError } from 'rxjs/operators';
import { cloneDeep, transform, isEqual } from 'lodash-es';
import { MetricService } from '../../core/services/metric.service';
import { AuthService } from '../../core/services/auth.service';
import { DateFormatService } from '../../core/services/date-format.service';
import { Metric, MetricDataType } from '../../models/metric.model';
import { PeriodMap, PeriodValue, TrackingDiff } from '../../models/metric-tracking.model';
import { CURRENCY_SYMBOLS, MEASUREMENT_UNIT_SYMBOLS } from '../../models/user.model';
import { MONTH_LABELS, isoWeekInfo } from '../utils/metric-period.util';

const DEFAULT_DECIMAL_POINTS = 2;

type RowKey = 'actual' | 'target';

interface CellCoord {
  row: RowKey;
  day: number;
}

// Same windowing choices as MetricBowlingComponent (this component is a
// single-metric adaptation of that page's per-row grid, embedded in the
// metric-form-modal's Statistics tab instead of a full page of rows) —
// duplicated rather than imported since they're page-local pagination
// constants, not domain logic.
const DAILY_WINDOW_SIZE = 15;
const WEEKLY_QUARTER_STARTS = [1, 14, 27, 40];
const YEARLY_BLOCK_SIZE = 5;

// Single-metric, editable Actual/Target-by-period grid — the same
// tracking data/editing model as the Bowling View's per-metric row
// (MetricBowlingComponent), reused here as its own component so the
// metric-form-modal's Statistics tab can embed just one metric's grid
// without pulling in the page's multi-row/lens-switching machinery.
@Component({
  selector: 'app-metric-tracking-grid',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './metric-tracking-grid.component.html',
  styleUrl: './metric-tracking-grid.component.css',
})
export class MetricTrackingGridComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) metric!: Metric;
  // Driven by the metric-form-modal's single shared year/month switcher
  // (visible above the tab strip, drives this grid + the Sheet tab + the
  // Statistics charts all at once) — already frequency-resolved by the
  // parent's own year/month getters: for a Daily metric this is the
  // selected calendar month; for every other frequency `month` is always
  // null and `year` is the selected year (the block's start year for
  // Yearly — see YEARLY_BLOCK_SIZE).
  @Input({ required: true }) year!: number;
  @Input() month: number | null = null;
  // Set by the owning modal for a Viewer (see canEditMetric there) — blocks
  // startEdit() so cells stay display-only; totals/window nav still work.
  @Input() readOnly = false;
  // Fired after a successful save so the parent can refresh whatever it
  // derives from the same tracking data (gauge/YTD totals/trend chart).
  @Output() saved = new EventEmitter<void>();

  @ViewChild('activeInput') activeInputRef?: ElementRef<HTMLInputElement>;

  periods: PeriodMap = {};
  private originalPeriods: PeriodMap = {};
  actualTotal = 0;
  targetTotal = 0;
  loading = false;
  saving = false;
  error = '';

  windowIndex = 0;

  editing: CellCoord | null = null;
  editValue = '';
  editError = '';

  // Captures {year, month} at the moment of the edit (not read fresh when
  // the debounce flushes) — otherwise switching the year/month picker
  // within the 500ms debounce window would save against the NEW period
  // instead of the one the edit was actually made in.
  private readonly saveTrigger = new Subject<{ year: number; month: number | null }>();
  private readonly saveSub: Subscription;

  constructor(
    private metricSvc: MetricService,
    public auth: AuthService,
    public dateFormat: DateFormatService
  ) {
    this.saveSub = this.saveTrigger.pipe(debounceTime(500), concatMap((t) => this.doSave(t.year, t.month))).subscribe();
  }

  private get decimalPoints(): number {
    return this.auth.currentUser()?.decimalPoints ?? DEFAULT_DECIMAL_POINTS;
  }

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['metric'] && this.metric) || changes['year'] || changes['month']) {
      this.windowIndex = this.initialWindowIndex();
      this.editing = null;
      this.editError = '';
      this.load();
    }
  }

  ngOnDestroy() {
    this.saveSub.unsubscribe();
  }

  // Positions the initial window on "today" rather than always the first
  // page — daily/weekly are the only lenses with more than one window, and
  // landing on whichever page contains the current day/week is far more
  // useful than always opening on day 1 / week 1. Only applies when the
  // switcher is actually showing the real current year/month — otherwise
  // (browsing a past/future period) "today"'s day-of-month/ISO-week has no
  // relevance to the selected window, so default to the first page instead.
  private initialWindowIndex(): number {
    const now = new Date();
    if (this.metric.frequency === 'daily') {
      if (this.year !== now.getFullYear() || this.month !== now.getMonth() + 1) return 0;
      return Math.floor((now.getDate() - 1) / DAILY_WINDOW_SIZE);
    }
    if (this.metric.frequency === 'weekly') {
      const info = isoWeekInfo(now);
      if (this.year !== info.year) return 0;
      return this.quarterIndexForWeek(info.week);
    }
    return 0;
  }

  get daysInMonth(): number {
    return new Date(this.year, this.month ?? 1, 0).getDate();
  }

  // ISO 8601: a year has 53 weeks iff Jan 1 falls on a Thursday, or it's a
  // leap year and Jan 1 falls on a Wednesday — mirrors backend/utils/
  // metricPeriods.ts's isoWeeksInYear so client-side windowing agrees with
  // what the server will actually accept.
  get weeksInYear(): number {
    const year = this.year;
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const jan1Day = new Date(year, 0, 1).getDay();
    if (jan1Day === 4) return 53;
    if (jan1Day === 3 && isLeap) return 53;
    return 52;
  }

  private weeklyQuarterRange(quarterIndex: number): [number, number] {
    const start = WEEKLY_QUARTER_STARTS[quarterIndex];
    const end = quarterIndex < 3 ? WEEKLY_QUARTER_STARTS[quarterIndex + 1] - 1 : this.weeksInYear;
    return [start, end];
  }

  private quarterIndexForWeek(week: number): number {
    let index = 0;
    while (index < WEEKLY_QUARTER_STARTS.length - 1 && week >= WEEKLY_QUARTER_STARTS[index + 1]) index++;
    return index;
  }

  get totalWindows(): number {
    const frequency = this.metric.frequency;
    if (frequency === 'monthly' || frequency === 'quarterly' || frequency === 'yearly') return 1;
    if (frequency === 'weekly') return WEEKLY_QUARTER_STARTS.length;
    return Math.max(1, Math.ceil(this.daysInMonth / DAILY_WINDOW_SIZE));
  }

  get visibleDays(): number[] {
    const frequency = this.metric.frequency;
    if (frequency === 'monthly') return Array.from({ length: 12 }, (_, i) => i + 1);
    if (frequency === 'quarterly') return [1, 2, 3, 4];
    if (frequency === 'yearly') return Array.from({ length: YEARLY_BLOCK_SIZE }, (_, i) => i + 1);
    if (frequency === 'weekly') {
      const [start, end] = this.weeklyQuarterRange(this.windowIndex);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    const start = this.windowIndex * DAILY_WINDOW_SIZE + 1;
    const end = Math.min(start + DAILY_WINDOW_SIZE - 1, this.daysInMonth);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  get windowLabel(): string {
    const frequency = this.metric.frequency;
    const days = this.visibleDays;
    if (frequency === 'yearly') return `${this.year}–${this.year + YEARLY_BLOCK_SIZE - 1}`;
    if (frequency === 'monthly' || frequency === 'quarterly') return String(this.year);
    if (frequency === 'weekly') {
      const range = days.length === 1 ? `Week ${days[0]}` : `Weeks ${days[0]}–${days[days.length - 1]}`;
      return `Q${this.windowIndex + 1} · ${range}`;
    }
    return days.length === 1 ? `Day ${days[0]}` : `Days ${days[0]}–${days[days.length - 1]}`;
  }

  get navUnitLabel(): string {
    const frequency = this.metric.frequency;
    if (frequency === 'yearly') return `${YEARLY_BLOCK_SIZE} Years`;
    if (frequency === 'monthly' || frequency === 'quarterly') return 'Year';
    if (frequency === 'weekly') return 'Quarter';
    return `${DAILY_WINDOW_SIZE} Days`;
  }

  private weekStartDate(week: number): Date {
    const jan4 = new Date(this.year, 0, 4);
    const jan4DayMon1 = jan4.getDay() || 7; // Mon=1..Sun=7
    const week1Monday = new Date(this.year, 0, 4 - (jan4DayMon1 - 1));
    return new Date(week1Monday.getFullYear(), week1Monday.getMonth(), week1Monday.getDate() + (week - 1) * 7);
  }

  weekDateLabel(week: number): string {
    return this.dateFormat.formatDate(this.weekStartDate(week));
  }

  monthLabel(month: number): string {
    return MONTH_LABELS[month - 1];
  }

  quarterLabel(quarter: number): string {
    return `Q${quarter}`;
  }

  yearLabel(period: number): string {
    return String(this.year + period - 1);
  }

  columnLabel(period: number): string {
    const frequency = this.metric.frequency;
    if (frequency === 'daily') return String(period);
    if (frequency === 'weekly') return this.weekDateLabel(period);
    if (frequency === 'quarterly') return this.quarterLabel(period);
    if (frequency === 'yearly') return this.yearLabel(period);
    return this.monthLabel(period);
  }

  prevWindow() {
    if (this.windowIndex > 0) this.windowIndex--;
  }

  nextWindow() {
    if (this.windowIndex < this.totalWindows - 1) this.windowIndex++;
  }

  private load() {
    this.loading = true;
    this.error = '';
    const frequency = this.metric.frequency;
    this.metricSvc.getTracking(this.metric.id, frequency, this.year, this.month).subscribe({
      next: (data) => {
        this.periods = data.periods;
        this.originalPeriods = cloneDeep(data.periods);
        this.actualTotal = data.actualTotal;
        this.targetTotal = data.targetTotal;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load tracking data';
        this.loading = false;
      },
    });
  }

  cellValue(row: RowKey, day: number): number | null {
    return this.periods[String(day)]?.[row] ?? null;
  }

  // Decimal-formats a raw number per the viewing user's own decimalPoints
  // preference, then decorates it with a unit/symbol per the metric's
  // dataType — same convention as MetricBowlingComponent's formatValue()
  // and metric-value.util.ts's formatMetricValue().
  private formatValue(value: number, dataType: MetricDataType): string {
    const formatted = value.toFixed(this.decimalPoints);
    const rawOrg = this.auth.currentUser()?.organization;
    const org = rawOrg && typeof rawOrg === 'object' ? rawOrg : null;
    switch (dataType) {
      case 'currency':
        return `${CURRENCY_SYMBOLS[org?.currency ?? 'USD']}${formatted}`;
      case 'weight':
        return `${formatted} ${MEASUREMENT_UNIT_SYMBOLS[org?.unit ?? 'KG']}`;
      case 'percentage':
        return `${formatted}%`;
      default:
        return formatted;
    }
  }

  formatRead(row: RowKey, day: number): string {
    const value = this.cellValue(row, day);
    if (value === null) return '';
    return this.formatValue(value, this.metric.dataType);
  }

  formatTotal(row: RowKey): string {
    return this.formatValue(row === 'actual' ? this.actualTotal : this.targetTotal, this.metric.dataType);
  }

  isEditing(row: RowKey, day: number): boolean {
    return !!this.editing && this.editing.row === row && this.editing.day === day;
  }

  // Percentage metrics are stored/read in percentage-point scale (a stored
  // 70 means "70%"); typing is friendlier as a fraction (spreadsheet
  // convention: 0.7 means 70%), so the edit box shows/accepts the /100
  // form and converts back with *100 on commit.
  private toEditValue(stored: number, dataType: MetricDataType): number {
    return dataType === 'percentage' ? stored / 100 : stored;
  }

  private fromEditValue(entered: number, dataType: MetricDataType): number {
    return dataType === 'percentage' ? entered * 100 : entered;
  }

  startEdit(row: RowKey, day: number) {
    if (this.readOnly) return;
    const current = this.cellValue(row, day);
    this.editing = { row, day };
    const dataType = this.metric.dataType;
    if (current === null) {
      this.editValue = '';
    } else if (dataType === 'percentage') {
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

  // Applies the in-progress edit to local state (and queues a save)
  // without touching `editing` — the caller decides what happens to
  // edit-mode next. Returns false (leaving the cell in edit mode) if the
  // value is invalid.
  private applyCurrentEdit(): boolean {
    if (!this.editing) return true;
    if (!this.isValidRaw(this.editValue)) {
      this.editError = 'Enter a number';
      return false;
    }
    const { row, day } = this.editing;
    const value = this.editValue.trim() === '' ? null : this.fromEditValue(Number(this.editValue), this.metric.dataType);
    const key = String(day);
    const existing: PeriodValue = this.periods[key] ?? { actual: null, target: null };
    this.periods = { ...this.periods, [key]: { ...existing, [row]: value } };
    this.actualTotal = this.sumField(this.periods, 'actual');
    this.targetTotal = this.sumField(this.periods, 'target');
    this.saveTrigger.next({ year: this.year, month: this.month });
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

  onCellBlur() {
    if (!this.editing) return;
    if (this.applyCurrentEdit()) {
      this.editing = null;
      this.editError = '';
    }
  }

  // Tab order: the whole Actual line left-to-right, then the whole Target
  // line left-to-right — every currently-visible cell, in reading order.
  private get flatCellOrder(): CellCoord[] {
    const order: CellCoord[] = [];
    (['actual', 'target'] as RowKey[]).forEach((row) => {
      this.visibleDays.forEach((day) => order.push({ row, day }));
    });
    return order;
  }

  private moveTab(backwards: boolean) {
    if (!this.editing) return;
    if (!this.applyCurrentEdit()) return;
    const current = this.editing;
    this.editing = null;
    const order = this.flatCellOrder;
    const idx = order.findIndex((c) => c.row === current.row && c.day === current.day);
    const nextIdx = idx + (backwards ? -1 : 1);
    if (nextIdx >= 0 && nextIdx < order.length) {
      const next = order[nextIdx];
      this.startEdit(next.row, next.day);
    }
  }

  private moveArrow(dayDelta: number, rowToggle: number) {
    if (!this.editing) return;
    if (!this.applyCurrentEdit()) return;
    let { row, day } = this.editing;
    this.editing = null;
    if (dayDelta !== 0) day += dayDelta;
    if (rowToggle !== 0) row = row === 'actual' ? 'target' : 'actual';

    const days = this.visibleDays;
    if (day < days[0] || day > days[days.length - 1]) return; // out of the visible window — just exit edit mode
    this.startEdit(row, day);
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

  private doSave(year: number, month: number | null) {
    const diff = this.computeDiff(this.originalPeriods, this.periods);
    if (Object.keys(diff).length === 0) return of(null);

    this.saving = true;
    this.error = '';
    return this.metricSvc.saveTrackingDiff(this.metric.id, this.metric.frequency, year, month, diff).pipe(
      tap((res) => {
        this.originalPeriods = cloneDeep(this.periods);
        this.actualTotal = res.actualTotal;
        this.targetTotal = res.targetTotal;
        this.saving = false;
        this.saved.emit();
      }),
      catchError((err) => {
        this.saving = false;
        this.error = err.error?.message || 'Failed to save';
        return of(null);
      })
    );
  }
}
