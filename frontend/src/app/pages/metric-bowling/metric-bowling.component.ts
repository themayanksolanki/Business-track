import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, of } from 'rxjs';
import { groupBy, mergeMap, debounceTime, concatMap, tap, catchError } from 'rxjs/operators';
import { cloneDeep, transform, isEqual } from 'lodash-es';
import { MetricService } from '../../core/services/metric.service';
import { AuthService } from '../../core/services/auth.service';
import { MetricListItem, MetricDataType } from '../../models/metric.model';
import { PeriodMap, PeriodValue, TrackingDiff } from '../../models/metric-tracking.model';
import { CURRENCY_SYMBOLS, MEASUREMENT_UNIT_SYMBOLS } from '../../models/user.model';

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

const WINDOW_SIZE = 15;

@Component({
  selector: 'app-metric-bowling',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './metric-bowling.component.html',
  styleUrl: './metric-bowling.component.css',
})
export class MetricBowlingComponent implements OnInit {
  @ViewChild('activeInput') activeInputRef?: ElementRef<HTMLInputElement>;

  rows: BowlingRow[] = [];
  loading = false;
  error = '';

  // 'YYYY-MM', bound directly to <input type="month">.
  selectedMonthStr = this.defaultMonthStr();
  windowIndex = 0;

  editing: CellCoord | null = null;
  editValue = '';
  editError = '';

  // Captures {rowIndex, year, month} at the moment of the edit (not read
  // fresh when the debounce flushes) — otherwise switching the month picker
  // within the 500ms debounce window would save against the NEW month
  // instead of the one the edit was actually made in.
  private readonly saveTrigger = new Subject<{ rowIndex: number; year: number; month: number }>();

  constructor(
    private metricService: MetricService,
    public auth: AuthService
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
        mergeMap((group$) => group$.pipe(debounceTime(500), concatMap((t) => this.doSave(t.rowIndex, t.year, t.month))))
      )
      .subscribe();

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

  get totalWindows(): number {
    return Math.max(1, Math.ceil(this.daysInMonth / WINDOW_SIZE));
  }

  get visibleDays(): number[] {
    const start = this.windowIndex * WINDOW_SIZE + 1;
    const end = Math.min(start + WINDOW_SIZE - 1, this.daysInMonth);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  get windowLabel(): string {
    const days = this.visibleDays;
    return days.length === 1 ? `Day ${days[0]}` : `Days ${days[0]}–${days[days.length - 1]}`;
  }

  onMonthChange() {
    this.windowIndex = 0;
    this.loadAllTracking();
  }

  prevWindow() {
    if (this.windowIndex > 0) this.windowIndex--;
  }

  nextWindow() {
    if (this.windowIndex < this.totalWindows - 1) this.windowIndex++;
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

  private loadTracking(rowIndex: number) {
    const row = this.rows[rowIndex];
    row.loading = true;
    row.error = '';
    this.metricService.getTracking(row.item.id, 'daily', this.year, this.month).subscribe({
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
    this.saveTrigger.next({ rowIndex, year: this.year, month: this.month });
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
    this.rows.forEach((_, rowIndex) => {
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

  private doSave(rowIndex: number, year: number, month: number) {
    const rowData = this.rows[rowIndex];
    const diff = this.computeDiff(rowData.originalPeriods, rowData.periods);
    if (Object.keys(diff).length === 0) return of(null);

    rowData.saving = true;
    rowData.error = '';
    return this.metricService.saveTrackingDiff(rowData.item.id, 'daily', year, month, diff).pipe(
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
