import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HotTableComponent, NON_COMMERCIAL_LICENSE, GridSettings } from '@handsontable/angular-wrapper';
import { registerAllModules } from 'handsontable/registry';
import { textRenderer } from 'handsontable/renderers';
import { of, forkJoin } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { cloneDeep, isEqual } from 'lodash-es';
import { MetricService } from '../../core/services/metric.service';
import { DateFormatService } from '../../core/services/date-format.service';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { Metric, MetricColumnLabels } from '../../models/metric.model';
import { PeriodValue, TrackingDiff, MetricRagStatus, MetricFrequency } from '../../models/metric-tracking.model';
import { MONTH_LABELS, periodCount, isoWeekInfo, weeklyQuarterRanges } from '../utils/metric-period.util';
import { formatMetricValue, metricColumnLabel, DEFAULT_METRIC_COLUMN_LABELS, calculateRagStatus } from '../utils/metric-value.util';
import { FrequencyIconComponent } from '../frequency-icon/frequency-icon.component';

const DEFAULT_DECIMAL_POINTS = 2;
// Narrower than FieldKey (which also has 'status'/'note') — lets
// DailyRollupDay/rollup code index by field without an `any` escape hatch,
// since a rollup never touches Status/Notes.
type NumericFieldKey = 'actual' | 'target' | 'lowest' | 'medium' | 'upper';
const NUMERIC_FIELD_KEYS: FieldKey[] = ['actual', 'target', 'lowest', 'medium', 'upper'];
const ROLLUP_NUMERIC_FIELDS: NumericFieldKey[] = ['actual', 'target', 'lowest', 'medium', 'upper'];

// "Upper" (coarser) frequency a metric's native tracking can be rolled up
// and viewed as, read-only — e.g. a Daily metric's days summed into weeks/
// months/quarters/years. weekly→monthly is deliberately omitted: an ISO
// week can straddle two calendar months, so "which month does this week
// belong to" has no clean answer — unlike every other pairing here.
const ROLLUP_TARGETS: Record<MetricFrequency, MetricFrequency[]> = {
  daily: ['weekly', 'monthly', 'quarterly', 'yearly'],
  weekly: ['quarterly', 'yearly'],
  monthly: ['quarterly', 'yearly'],
  quarterly: ['yearly'],
  yearly: [],
};
const FREQUENCY_LABELS: Record<MetricFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

// One calendar day, tagged with its real date — only built when the native
// metric is Daily and a rollup view is active, since that's the one case
// where a single getTracking() call doesn't already cover the whole year
// (daily documents are scoped per month). Status/Notes are intentionally
// not carried here — rollups never show them (see ROLLUP_NUMERIC_FIELDS).
interface DailyRollupDay {
  date: Date;
  actual: number | null;
  target: number | null;
  lowest: number | null;
  medium: number | null;
  upper: number | null;
}

// Registers every Handsontable module (cell types, renderers, editors,
// plugins) against the modular "base" build the Angular wrapper uses
// internally — first and only Handsontable usage in this app, so this runs
// once at module load rather than needing an app-wide bootstrap step.
registerAllModules();

type FieldKey = 'actual' | 'target' | 'lowest' | 'medium' | 'upper' | 'status' | 'note';
const FIELD_KEYS: FieldKey[] = ['actual', 'target', 'lowest', 'medium', 'upper', 'status', 'note'];
const STATUS_COLORS: Record<string, string> = { Red: '#ef4444', Yellow: '#f59e0b', Green: '#22c55e' };
// '#' only ever holds a 1-2 digit sequence number — narrow and fixed, unlike
// every other column, which should share the rest of the grid's width. Used
// with stretchH: 'last' (not 'all') on the periods-as-rows layouts below: with
// 'all', Handsontable stretches every column — including this one —
// proportionally to fill the container, which is exactly what widens '#'
// past what its content needs; 'last' instead pins every column but the last
// to its given width and lets only the last column absorb the leftover space.
const SEQ_COLUMN_WIDTH = 40;

interface SheetRow {
  period: number;
  actual: number | null;
  target: number | null;
  lowest: number | null;
  medium: number | null;
  upper: number | null;
  status: MetricRagStatus | null;
  note: string;
}

// 'periods-as-rows' matches the fixed column order the feature was specced
// with (Seq, Date, Actual, Target, ...); 'periods-as-columns' mirrors the
// Bowling View's layout (one row per field, periods running across) — the
// "swap rows to columns and columns to rows" ask, picked via the dropdown
// above the grid rather than a plain toggle button.
type Orientation = 'periods-as-rows' | 'periods-as-columns';


@Component({
  selector: 'app-metric-sheet',
  standalone: true,
  imports: [CommonModule, HotTableComponent, FrequencyIconComponent],
  templateUrl: './metric-sheet.component.html',
  styleUrl: './metric-sheet.component.css',
})
export class MetricSheetComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) metric!: Metric;
  // Driven by the metric-form-modal's single shared year/month switcher —
  // already frequency-resolved by the parent (month is always null except
  // for a Daily metric). Replaces what used to be this component's own
  // independent selectedMonthStr/selectedYear picker.
  @Input({ required: true }) year!: number;
  @Input() month: number | null = null;
  // Set by the owning modal for a Viewer (see canEditMetric there) — forces
  // every native-grid cell readOnly regardless of orientation/rollup, and
  // hides the rename-columns affordance. Rollup grids are already always
  // readOnly on their own (see rebuildRollupGrid), so this only changes
  // anything for the native/editable grid.
  @Input() readOnly = false;
  // Mirrors metric-tracking-grid's convention so a future caller could
  // refresh shared trend/gauge state the same way the Statistics tab does.
  @Output() saved = new EventEmitter<void>();
  // Fired after a column-rename save so the owning modal can refresh its
  // local `initial` reference (columnLabels lives on the Metric itself).
  @Output() metricUpdated = new EventEmitter<Metric>();

  // Direct handle to the live Handsontable instance — used for the native
  // instance methods (render(), getActiveEditor(), getCellMeta()) driving
  // click-to-edit and the hover title below; Angular's [data]/[settings]
  // rebinding handles the "just redraw with new data" case on its own.
  @ViewChild(HotTableComponent) private hotTableRef?: HotTableComponent;

  readonly licenseKey = NON_COMMERCIAL_LICENSE;
  readonly orientationOptions: { value: Orientation; label: string; icon: string }[] = [
    { value: 'periods-as-rows', label: 'Periods as rows', icon: 'bi-table' },
    { value: 'periods-as-columns', label: 'Periods as columns', icon: 'bi-arrow-left-right' },
  ];
  orientation: Orientation = 'periods-as-rows';

  get selectedOrientationOption() {
    return this.orientationOptions.find((o) => o.value === this.orientation) ?? this.orientationOptions[0];
  }

  get selectedViewOption(): { value: MetricFrequency; label: string } {
    return this.rollupOptions.find((o) => o.value === this.viewFrequency) ?? this.rollupOptions[0];
  }

  // Overwritten to the metric's own frequency on every load (see
  // resetForMetric()) — 'daily' here is just a pre-@Input placeholder.
  viewFrequency: MetricFrequency = 'daily';

  rows: SheetRow[] = [];
  private originalRows: SheetRow[] = [];
  // Cache of the one 12-request fetch a Daily-metric rollup needs (weekly/
  // monthly/quarterly/yearly view of a Daily metric) — re-only fetched when
  // the rollup year actually changes, not on every orientation/view toggle.
  private dailyRollupYear: number | null = null;
  private dailyRollupDays: DailyRollupDay[] = [];
  loading = false;
  saving = false;
  error = '';

  hotData: unknown[][] = [];
  hotSettings: GridSettings = {};

  // Which column/row header (if any) is currently showing its rename
  // <input> in place of its plain label — see wireHeaderCell(). Only one at
  // a time: clicking another header while this is set is ignored until the
  // current edit resolves (Enter/blur/Escape), same as a normal form.
  editingHeaderField: FieldKey | null = null;
  private headerDraftValue = '';
  private headerInputFocused = false;
  private activeHeaderInput: HTMLInputElement | null = null;

  // "Was this exact cell already selected right before this click" tracker
  // for the click-to-edit heuristic in onSelectionEnd() — reset by
  // rebuildGrid() whenever the grid's shape changes.
  private lastSelectedRow: number | null = null;
  private lastSelectedCol: number | null = null;

  constructor(
    private metricSvc: MetricService,
    public dateFormat: DateFormatService,
    private auth: AuthService,
    public themeSvc: ThemeService
  ) {}

  // Same lookups/fallbacks as metric-tracking-grid.component.ts's private
  // formatValue() — the org's currency/unit choice is org-wide (set once,
  // same for everyone), decimalPoints is the viewing user's own preference.
  private get decimalPoints(): number {
    return this.auth.currentUser()?.decimalPoints ?? DEFAULT_DECIMAL_POINTS;
  }

  private get orgCurrency() {
    const org = this.auth.currentUser()?.organization;
    return org && typeof org === 'object' ? org.currency : 'USD';
  }

  private get orgUnit() {
    const org = this.auth.currentUser()?.organization;
    return org && typeof org === 'object' ? org.unit : 'KG';
  }

  private isNumericField(field: FieldKey): boolean {
    return NUMERIC_FIELD_KEYS.includes(field);
  }

  // Percentage metrics store/diff/save in percentage-point scale (70 means
  // "70%", matching MetricEntry/backend convention) but are edited as a
  // fraction (0.7) — spreadsheet convention, and consistent with the
  // existing Statistics-tab grid's identical choice. Only the Handsontable
  // *editable cell value* goes through this transform; `this.rows` (and
  // everything derived from it — diff/save) stays in canonical scale always.
  private toDisplayValue(field: FieldKey, stored: number | null): number | null {
    if (stored === null) return null;
    return this.metric.dataType === 'percentage' && this.isNumericField(field) ? stored / 100 : stored;
  }

  private fromDisplayValue(field: FieldKey, entered: number | null): number | null {
    if (entered === null) return null;
    return this.metric.dataType === 'percentage' && this.isNumericField(field) ? entered * 100 : entered;
  }

  // year/month now arrive as @Inputs from the metric-form-modal's shared
  // switcher rather than an internal picker — reacting to them changing
  // (independent of a metric swap) does exactly what onYearChange() used to.
  ngOnChanges(changes: SimpleChanges) {
    if (changes['metric'] && this.metric) {
      // Flush edits against whatever this component was just showing before
      // load() below replaces this.rows outright — e.g. a column-rename save
      // re-emits a refreshed Metric object, which re-fires this branch even
      // though it's the same metric/period, and edits no longer auto-save.
      this.saveNow();
      this.viewFrequency = this.metric.frequency;
      this.dailyRollupYear = null;
      this.dailyRollupDays = [];
      this.error = '';
      this.load();
      return;
    }
    if (changes['year'] || changes['month']) {
      // Same reasoning for the shared year/month switcher — save against the
      // period being LEFT (previousValue) before switching, since edits only
      // live in this.rows until saveNow() runs and load()/loadDailyRollup()
      // below is about to overwrite this.rows for the newly-selected period.
      const prevYear = changes['year'] ? changes['year'].previousValue : this.year;
      const prevMonth = changes['month'] ? changes['month'].previousValue : this.month;
      this.doSave(prevYear, prevMonth).subscribe();
      if (this.metric.frequency === 'daily' && this.isRollup) {
        this.loadDailyRollup();
      } else {
        this.load();
      }
    }
  }

  // The owning modal's Sheet tab content only exists while activeTab ===
  // 'sheet' (an @if, not a hide/show) — so switching to another tab tears
  // this component down and runs this hook, making it the natural place to
  // flush any edits that haven't been saved yet. The other two triggers
  // (Save button, closing the modal while still on the Sheet tab) don't
  // destroy this component, so the modal calls saveNow() directly for those.
  ngOnDestroy() {
    this.saveNow();
  }

  // Edits only update `this.rows` in memory (see onAfterChange) — no
  // network call happens until this fires. Safe to call with nothing
  // pending: doSave()'s computeDiff() short-circuits to a no-op then.
  saveNow() {
    this.doSave(this.year, this.month).subscribe();
  }

  // True whenever the "View as" dropdown is showing something coarser than
  // the metric's own tracked frequency — a read-only rollup, never the
  // editable native grid.
  get isRollup(): boolean {
    return this.viewFrequency !== this.metric.frequency;
  }

  // First entry is always the native frequency (editable); the rest are
  // whatever coarser frequencies ROLLUP_TARGETS says this native frequency
  // can be rolled up into. Empty apart from the native entry for Yearly,
  // since nothing is coarser than Yearly.
  get rollupOptions(): { value: MetricFrequency; label: string }[] {
    const native = this.metric.frequency;
    const options = [{ value: native, label: `${FREQUENCY_LABELS[native]} (native)` }];
    for (const target of ROLLUP_TARGETS[native]) options.push({ value: target, label: `${FREQUENCY_LABELS[target]} (rollup)` });
    return options;
  }

  setViewFrequency(value: MetricFrequency) {
    if (this.viewFrequency === value) return;
    this.viewFrequency = value;
    // Only a Daily-native rollup needs its own fetch (a single getTracking()
    // call for Daily only ever covers one month) — every other native
    // frequency's getTracking() call already returns its whole year, so
    // `this.rows` (loaded by the last load()) already has everything a
    // Weekly/Monthly/Quarterly rollup needs; just re-render from it.
    if (this.metric.frequency === 'daily' && this.isRollup) {
      this.loadDailyRollup();
    } else {
      this.rebuildGrid();
    }
  }

  setOrientation(value: Orientation) {
    if (this.orientation === value) return;
    this.orientation = value;
    this.rebuildGrid();
  }

  private fieldLabel(key: FieldKey): string {
    return metricColumnLabel(this.metric.columnLabels, key);
  }

  // No day-windowing here (unlike metric-tracking-grid/metric-bowling) —
  // Handsontable scrolls the full period range natively, so the whole
  // document loaded from getTracking() renders at once.
  private periodLabel(period: number): string {
    const frequency = this.metric.frequency;
    if (frequency === 'daily') return this.dateFormat.formatDate(new Date(this.year, (this.month ?? 1) - 1, period));
    if (frequency === 'weekly') return `Wk ${period} · ${this.dateFormat.formatDate(this.weekStartDate(period))}`;
    if (frequency === 'quarterly') return `Q${period}`;
    if (frequency === 'yearly') return String(this.year + period - 1);
    return MONTH_LABELS[period - 1];
  }

  private weekStartDate(week: number): Date {
    const jan4 = new Date(this.year, 0, 4);
    const jan4DayMon1 = jan4.getDay() || 7; // Mon=1..Sun=7
    const week1Monday = new Date(this.year, 0, 4 - (jan4DayMon1 - 1));
    return new Date(week1Monday.getFullYear(), week1Monday.getMonth(), week1Monday.getDate() + (week - 1) * 7);
  }

  private load() {
    this.loading = true;
    this.error = '';
    const frequency = this.metric.frequency;
    const year = this.year;
    const month = this.month;
    this.metricSvc.getTracking(this.metric.id, frequency, year, month).subscribe({
      next: (data) => {
        const count = periodCount(frequency, year, month);
        this.rows = Array.from({ length: count }, (_, i) => this.rowFromPeriod(i + 1, data.periods[String(i + 1)]));
        this.originalRows = cloneDeep(this.rows);
        this.loading = false;
        this.rebuildGrid();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load tracking data';
        this.loading = false;
      },
    });
  }

  // Only reachable for a Daily-native metric viewing a rollup — fetches all
  // 12 months of `this.year` (Daily's own getTracking() call only
  // ever returns one month) so weekly/monthly/quarterly/yearly buckets can
  // be built from a real full year of days, cached until the year changes.
  private loadDailyRollup() {
    const year = this.year;
    if (this.dailyRollupYear === year && this.dailyRollupDays.length) {
      this.rebuildGrid();
      return;
    }
    this.loading = true;
    this.error = '';
    const requests = Array.from({ length: 12 }, (_, i) => this.metricSvc.getTracking(this.metric.id, 'daily', year, i + 1));
    forkJoin(requests).subscribe({
      next: (months) => {
        const days: DailyRollupDay[] = [];
        months.forEach((data, monthIndex) => {
          const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
          for (let d = 1; d <= daysInMonth; d++) {
            const v = data.periods[String(d)];
            days.push({
              date: new Date(year, monthIndex, d),
              actual: v?.actual ?? null,
              target: v?.target ?? null,
              lowest: v?.lowest ?? null,
              medium: v?.medium ?? null,
              upper: v?.upper ?? null,
            });
          }
        });
        this.dailyRollupYear = year;
        this.dailyRollupDays = days;
        this.loading = false;
        this.rebuildGrid();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load rollup data';
        this.loading = false;
      },
    });
  }

  // Groups a full year of days into buckets for the given (coarser) target
  // frequency. Weekly bucketing skips any day whose ISO week-year doesn't
  // match `year` (the week that overlaps the prior/next calendar year) —
  // same boundary the native Weekly frequency's own periodCount() already
  // draws, so a Daily→Weekly rollup and a real Weekly metric agree on what
  // "week 1" and "the last week" mean.
  private bucketDailyDays(days: DailyRollupDay[], target: MetricFrequency, year: number): { label: string; days: DailyRollupDay[] }[] {
    if (target === 'weekly') {
      const map = new Map<number, DailyRollupDay[]>();
      for (const day of days) {
        const info = isoWeekInfo(day.date);
        if (info.year !== year) continue;
        const bucket = map.get(info.week);
        if (bucket) bucket.push(day);
        else map.set(info.week, [day]);
      }
      return Array.from(map.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([week, ds]) => ({ label: `Wk ${week}`, days: ds }));
    }
    if (target === 'monthly') {
      const buckets = MONTH_LABELS.map((label) => ({ label, days: [] as DailyRollupDay[] }));
      for (const day of days) buckets[day.date.getMonth()].days.push(day);
      return buckets;
    }
    if (target === 'quarterly') {
      const buckets = [1, 2, 3, 4].map((q) => ({ label: `Q${q}`, days: [] as DailyRollupDay[] }));
      for (const day of days) buckets[Math.floor(day.date.getMonth() / 3)].days.push(day);
      return buckets;
    }
    // yearly
    return [{ label: String(year), days }];
  }

  // Non-Daily rollups never need a separate fetch (see setViewFrequency) —
  // `this.rows` already holds the native frequency's whole year, so this
  // just groups its period NUMBERS (not dates) into buckets for the target.
  private rollupBuckets(target: MetricFrequency): { label: string; periods: number[] }[] {
    const native = this.metric.frequency;
    const year = this.year;
    if (native === 'monthly' && target === 'quarterly') {
      return [1, 2, 3, 4].map((q) => ({ label: `Q${q}`, periods: [q * 3 - 2, q * 3 - 1, q * 3] }));
    }
    if (native === 'monthly' && target === 'yearly') {
      return [{ label: String(year), periods: Array.from({ length: 12 }, (_, i) => i + 1) }];
    }
    if (native === 'weekly' && target === 'quarterly') {
      return weeklyQuarterRanges(year).map(([start, end], i) => ({
        label: `Q${i + 1}`,
        periods: Array.from({ length: end - start + 1 }, (_, k) => start + k),
      }));
    }
    if (native === 'weekly' && target === 'yearly') {
      return [{ label: String(year), periods: Array.from({ length: this.rows.length }, (_, i) => i + 1) }];
    }
    if (native === 'quarterly' && target === 'yearly') {
      return [{ label: String(year), periods: [1, 2, 3, 4] }];
    }
    return [];
  }

  // Actual/Target sum (matches the existing actualTotal/targetTotal
  // convention) unless the metric is Percentage, where summing percentage-
  // point values across periods isn't meaningful — average instead.
  // Lowest/Medium/Upper are threshold bands, never additive, always
  // average. Nulls are excluded from both the sum and the divisor; an
  // all-null bucket rolls up to null, not 0.
  private aggregateValues(field: FieldKey, values: (number | null)[]): number | null {
    const nums = values.filter((v): v is number => typeof v === 'number');
    if (!nums.length) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    const useAverage = field === 'lowest' || field === 'medium' || field === 'upper' || this.metric.dataType === 'percentage';
    return useAverage ? sum / nums.length : sum;
  }

  // Bucket labels + per-field aggregates for the active rollup, sourced
  // from whichever of the two bucketing paths applies.
  private rollupData(): { label: string; values: Partial<Record<FieldKey, number | null>> }[] {
    const target = this.viewFrequency;
    if (this.metric.frequency === 'daily') {
      const buckets = this.bucketDailyDays(this.dailyRollupDays, target, this.year);
      return buckets.map((b) => ({
        label: b.label,
        values: Object.fromEntries(ROLLUP_NUMERIC_FIELDS.map((f) => [f, this.aggregateValues(f, b.days.map((d) => d[f]))])),
      }));
    }
    const buckets = this.rollupBuckets(target);
    return buckets.map((b) => ({
      label: b.label,
      values: Object.fromEntries(ROLLUP_NUMERIC_FIELDS.map((f) => [f, this.aggregateValues(f, b.periods.map((p) => this.rows[p - 1]?.[f] as number | null))])),
    }));
  }

  private formatRollupValue(field: FieldKey, value: number | null): string {
    return value === null ? '' : formatMetricValue(value, this.metric.dataType, this.orgCurrency, this.orgUnit, this.decimalPoints);
  }

  // Status/Notes are never shown here — there's no sensible "Status of a
  // whole quarter." The whole grid is readOnly: this is a summary view, not
  // a second place to edit the same data (per the "only view, no entry"
  // requirement this rollup was built for).
  private rebuildRollupGrid() {
    const buckets = this.rollupData();
    // cells/afterChange/afterSelectionEnd/afterOnCellMouseOver are all
    // explicitly no-op'd here (rather than omitted) because Handsontable's
    // updateSettings() only touches keys actually present on the object you
    // pass it — omitting a key leaves whatever the PREVIOUS updateSettings
    // call bound. Without this, switching from the native grid into a
    // rollup left the native grid's `cells` callback (and its
    // numericFieldRenderer, which reads this.rows by row position) and its
    // afterSelectionEnd click-to-edit hook still active, so rollup cells
    // rendered stale native values and were secretly still editable.
    const noCells = () => ({});
    const noop = () => {};
    if (this.orientation === 'periods-as-rows') {
      this.hotData = buckets.map((b, i) => [i + 1, b.label, ...ROLLUP_NUMERIC_FIELDS.map((f) => this.formatRollupValue(f, b.values[f] ?? null))]);
      this.hotSettings = {
        licenseKey: this.licenseKey,
        colHeaders: ['#', 'Period', ...ROLLUP_NUMERIC_FIELDS.map((f) => this.fieldLabel(f))],
        colWidths: [SEQ_COLUMN_WIDTH, ...Array(1 + ROLLUP_NUMERIC_FIELDS.length).fill(100)],
        rowHeaders: false,
        readOnly: true,
        copyPaste: true,
        manualColumnResize: true,
        stretchH: 'last',
        height: 480,
        width: '100%',
        cells: noCells,
        afterChange: noop,
        afterSelectionEnd: noop,
        afterOnCellMouseOver: noop,
        afterGetColHeader: (col: number, th: HTMLElement) => this.onGetColHeader(col, th),
        afterGetRowHeader: noop,
      };
    } else {
      this.hotData = ROLLUP_NUMERIC_FIELDS.map((f) => buckets.map((b) => this.formatRollupValue(f, b.values[f] ?? null)));
      this.hotSettings = {
        licenseKey: this.licenseKey,
        colHeaders: buckets.map((b) => b.label),
        rowHeaders: ROLLUP_NUMERIC_FIELDS.map((f) => this.fieldLabel(f)),
        readOnly: true,
        copyPaste: true,
        manualColumnResize: true,
        stretchH: 'all',
        height: 320,
        width: '100%',
        cells: noCells,
        afterChange: noop,
        afterSelectionEnd: noop,
        afterOnCellMouseOver: noop,
        afterGetColHeader: noop,
        afterGetRowHeader: (row: number, th: HTMLElement) => this.onGetRowHeader(row, th),
      };
    }
  }

  private rowFromPeriod(period: number, value?: PeriodValue): SheetRow {
    const actual = value?.actual ?? null;
    const lowest = value?.lowest ?? null;
    const medium = value?.medium ?? null;
    const upper = value?.upper ?? null;
    return {
      period,
      actual,
      target: value?.target ?? null,
      lowest,
      medium,
      upper,
      // Always derived (see calculateRagStatus) — never trusts a stored
      // status value, so legacy manually-entered statuses get corrected on
      // load too, not just on the next edit.
      status: calculateRagStatus(actual, lowest, medium, upper),
      note: value?.note ?? '',
    };
  }

  // --- Grid construction ------------------------------------------------

  private rebuildGrid() {
    this.lastSelectedRow = null;
    this.lastSelectedCol = null;
    if (this.isRollup) {
      this.rebuildRollupGrid();
      this.applyGridToHotInstance();
      return;
    }
    if (this.orientation === 'periods-as-rows') {
      this.hotData = this.rows.map((r) => [
        r.period,
        this.periodLabel(r.period),
        this.toDisplayValue('actual', r.actual),
        this.toDisplayValue('target', r.target),
        this.toDisplayValue('lowest', r.lowest),
        this.toDisplayValue('medium', r.medium),
        this.toDisplayValue('upper', r.upper),
        r.status,
        r.note,
      ]);
      this.hotSettings = {
        licenseKey: this.licenseKey,
        colHeaders: ['#', 'Date', ...FIELD_KEYS.map((k) => this.fieldLabel(k))],
        colWidths: [SEQ_COLUMN_WIDTH, ...Array(1 + FIELD_KEYS.length).fill(100)],
        rowHeaders: false,
        manualColumnResize: true,
        // Both are Handsontable defaults already (registerAllModules()
        // just makes the plugins available) — set explicitly so the
        // decision to allow copy/paste and drag-fill is visible here rather
        // than relying on an unstated default. autoInsertRow: false because
        // the period range is fixed by the metric's frequency/date window —
        // dragging the fill handle past the last row should stop, not
        // fabricate new periods.
        copyPaste: true,
        fillHandle: { autoInsertRow: false },
        // Row/column count is fixed by periodCount(frequency, year, month)
        // (12 for monthly, 52/53 for weekly, days-in-month for daily, etc.)
        // — `data`'s length IS that count, and minSpareRows/minSpareCols
        // default to 0 already so nothing pads it further. These four are
        // genuinely no-ops today (they only gate context-menu "insert/
        // remove row/column" items, and no contextMenu is enabled here) but
        // are set explicitly as a guard against the count ever drifting if
        // a context menu gets added later.
        allowInsertRow: false,
        allowInsertColumn: false,
        allowRemoveRow: false,
        allowRemoveColumn: false,
        stretchH: 'last',
        height: 480,
        width: '100%',
        cells: (_row: number, col: number) => this.cellPropsNormal(col),
        afterChange: (changes: unknown, source: unknown) => this.onAfterChange(changes as unknown[][] | null, source as string),
        afterSelectionEnd: (row: unknown, column: unknown, row2: unknown, column2: unknown) =>
          this.onSelectionEnd(row as number, column as number, row2 as number, column2 as number),
        afterOnCellMouseOver: (_event: unknown, coords: unknown, td: unknown) => this.onCellHover(coords as { row: number; col: number }, td as HTMLTableCellElement),
        afterGetColHeader: (col: number, th: HTMLElement) => this.onGetColHeader(col, th),
        afterGetRowHeader: () => {},
      };
    } else {
      this.hotData = FIELD_KEYS.map((key) => this.rows.map((r) => (this.isNumericField(key) ? this.toDisplayValue(key, r[key] as number | null) : r[key])));
      this.hotSettings = {
        licenseKey: this.licenseKey,
        colHeaders: this.rows.map((r) => this.periodLabel(r.period)),
        rowHeaders: FIELD_KEYS.map((k) => this.fieldLabel(k)),
        manualColumnResize: true,
        copyPaste: true,
        fillHandle: { autoInsertRow: false },
        // Same fixed-count guard as the periods-as-rows branch above —
        // here periods are the COLUMN axis, so this is what would matter
        // if a paste/fill ever tried to grow it.
        allowInsertRow: false,
        allowInsertColumn: false,
        allowRemoveRow: false,
        allowRemoveColumn: false,
        stretchH: 'all',
        height: 320,
        width: '100%',
        cells: (row: number) => this.cellPropsTransposed(row),
        afterChange: (changes: unknown, source: unknown) => this.onAfterChange(changes as unknown[][] | null, source as string),
        afterSelectionEnd: (row: unknown, column: unknown, row2: unknown, column2: unknown) =>
          this.onSelectionEnd(row as number, column as number, row2 as number, column2 as number),
        afterOnCellMouseOver: (_event: unknown, coords: unknown, td: unknown) => this.onCellHover(coords as { row: number; col: number }, td as HTMLTableCellElement),
        afterGetColHeader: () => {},
        afterGetRowHeader: (row: number, th: HTMLElement) => this.onGetRowHeader(row, th),
      };
    }
    this.applyGridToHotInstance();
  }

  // Drives the Handsontable instance directly instead of waiting on the
  // [data]/[settings] rebind (Angular change detection -> the
  // @handsontable/angular-wrapper's own ngOnChanges, which applies on the
  // *next* tick, after this synchronous method has already returned).
  // That matters beyond just feeling instant: the wrapper's ngOnChanges
  // calls `hotInstance.updateData()` for a `[data]` change, which is built
  // to patch an existing dataset in place — safe when the grid's shape
  // stays the same (e.g. editing a cell), but not when rebuildGrid() just
  // swapped to a table with a different row/column count and different
  // cell renderers entirely (native <-> rollup, or a view-frequency/
  // orientation change) — stale cells from the old shape could otherwise
  // survive at reused (row, col) positions until whatever the *next*
  // update happens to touch them. updateSettings() (new columns/renderers)
  // then loadData() (a full, not patched, data replacement — the same
  // call a plain non-Angular Handsontable integration would make) applied
  // ourselves, synchronously, guarantees a clean result immediately. Safe
  // to also let the wrapper's own (redundant, delayed) update run after —
  // applying the same already-current settings/data again is a no-op.
  // No-ops harmlessly if the grid hasn't mounted yet (e.g. the very first
  // load, while `loading` is still true).
  private applyGridToHotInstance() {
    const instance = this.hotTableRef?.hotInstance;
    if (!instance) return;
    instance.updateSettings(this.hotSettings);
    instance.loadData(this.hotData);
  }

  // Click-to-edit on an already-selected cell — mirrors Excel/Sheets: the
  // FIRST click on a cell only selects it (so its fill handle — the small
  // drag-to-copy square at the bottom-right corner — actually renders and
  // stays draggable), and a SECOND click on that same, now-already-selected
  // cell opens the editor. An editor open on a cell hides its fill handle
  // entirely, so auto-editing on every single click (the previous behavior)
  // meant the handle could never appear long enough to grab — this tracks
  // lastSelectedRow/Col to tell "just selected this" apart from "clicked an
  // already-selected cell" and only auto-edits on the latter. Reset to null
  // by rebuildGrid() whenever the grid's shape changes (rollup/orientation/
  // frequency/reload), since old row/col numbers could otherwise coincide
  // with a cell in the new layout that was never actually clicked.
  //
  // afterSelectionEnd (mouseup, once the click's own selection — and the
  // editor's prepare() against the newly active cell — has already
  // settled) rather than afterOnCellMouseDown: calling beginEditing() from
  // mousedown raced prepare(), so the editor could open before it had
  // captured the cell's real value. row2/column2 differ from row/column
  // during a drag-select, so bail out then rather than force-opening an
  // editor over a multi-cell selection. Read-only cells (Seq/Date columns)
  // are left alone.
  //
  // enableFullEditMode() matters just as much as the above: per
  // BaseEditor#beginEditing (handsontable/editors/baseEditor/baseEditor.mjs),
  // the textarea is only pre-filled with the cell's current value when the
  // editor is in "full edit mode" — otherwise it opens blank, ready for a
  // fresh typed value (the IME-friendly mode meant for "just start typing
  // over the selected cell"). Handsontable's own double-click/Enter/F2
  // paths call enableFullEditMode() before beginEditing() for exactly this
  // reason; skipping it (as this did before) is what made the editor show
  // blank on open — and then commit that blank over the real value on the
  // next outside click.
  private onSelectionEnd(row: number, column: number, row2: number, column2: number) {
    if (row !== row2 || column !== column2) {
      // A real drag-select (fill handle or shift-click range) — not a plain
      // click, so it shouldn't count as "selected" for the next click's
      // already-selected check either.
      this.lastSelectedRow = null;
      this.lastSelectedCol = null;
      return;
    }
    const alreadySelected = this.lastSelectedRow === row && this.lastSelectedCol === column;
    this.lastSelectedRow = row;
    this.lastSelectedCol = column;
    if (!alreadySelected) return;
    const instance = this.hotTableRef?.hotInstance;
    if (!instance) return;
    if (instance.getCellMeta(row, column)['readOnly']) return;
    const editor = instance.getActiveEditor();
    if (!editor) return;
    editor.enableFullEditMode();
    editor.beginEditing();
  }

  // Plain native <td title> tooltip on hover — a Notes cell with content
  // shows its full text without needing the heavier Comments plugin (that
  // was explicitly descoped for this pass).
  private onCellHover(coords: { row: number; col: number }, td: HTMLTableCellElement) {
    const field = this.fieldAtCoord(coords.row, coords.col);
    const period = this.periodAtCoord(coords.row, coords.col);
    const note = field === 'note' && period !== null ? this.rows[period - 1]?.note : '';
    td.title = note || '';
  }

  private cellPropsNormal(col: number): Record<string, unknown> {
    if (col === 0 || col === 1) return { readOnly: true };
    const field = FIELD_KEYS[col - 2];
    return field ? this.cellPropsForField(field) : { readOnly: true };
  }

  private cellPropsTransposed(row: number): Record<string, unknown> {
    const field = FIELD_KEYS[row];
    return field ? this.cellPropsForField(field) : { readOnly: true };
  }

  // `type: 'dropdown'`/`type: 'numeric'` already bundle a validator
  // (dropdownValidator / numericValidator, per Handsontable's own cell-type
  // registration) that runs on typed edits AND on paste/fill — but
  // Handsontable's own default (`allowInvalid: true`) only flags an invalid
  // value red, it doesn't stop it from reaching afterChange. `allowInvalid:
  // false` makes an invalid typed/pasted/dragged-fill value get rejected
  // outright (the cell keeps its previous value), so afterChange never even
  // sees it — this is what actually enforces "Red/Yellow/Green only" and
  // "numbers only" against paste, not just data-entry.
  private cellPropsForField(field: FieldKey): Record<string, unknown> {
    // Always readOnly (not gated on this.readOnly like the other fields) —
    // status is derived from actual/lowest/medium/upper (see
    // calculateRagStatus), never a direct edit target for anyone, viewer or
    // editor alike.
    if (field === 'status') {
      return {
        readOnly: true,
        // Marks the cell for the ::ng-deep override in
        // metric-sheet.component.css — Handsontable's own base renderer
        // adds 'htDimmed' to every readOnly cell, and its theme CSS colors
        // that class with `!important` (grey background, grey text),
        // which would otherwise stomp the inline RAG color set below.
        className: 'metric-status-cell',
        renderer: (instance: unknown, td: HTMLTableCellElement, row: number, col: number, prop: unknown, value: unknown, cellProperties: unknown) =>
          this.statusCellRenderer(instance, td, row, col, prop, value, cellProperties),
      };
    }
    if (field === 'note') return { type: 'text', readOnly: this.readOnly };
    return {
      type: 'numeric',
      allowInvalid: false,
      readOnly: this.readOnly,
      renderer: (instance: unknown, td: HTMLTableCellElement, row: number, col: number, prop: unknown, value: unknown, cellProperties: unknown) =>
        this.numericFieldRenderer(field, instance, td, row, col, prop, value, cellProperties),
    };
  }

  // Ignores the raw (possibly display/fraction-scaled, for Percentage) cell
  // value Handsontable passes in and instead formats the canonical value
  // straight from `this.rows` via the same formatMetricValue() the
  // Statistics-tab grid/Bowling View/Tiles gauges already use — so a
  // Currency metric shows "$70.00", Weight shows "70.00 kg", Percentage
  // shows "70.00%" (even though the editable cell holds 0.7), all decorated
  // per the org's currency/unit and the viewing user's decimalPoints. The
  // NumericEditor still edits the raw underlying value when the cell is
  // clicked — this renderer only controls the read-mode look.
  private numericFieldRenderer(
    field: FieldKey,
    instance: unknown,
    td: HTMLTableCellElement,
    row: number,
    col: number,
    prop: unknown,
    value: unknown,
    cellProperties: unknown
  ) {
    const display = value === null || value === undefined || value === '' ? '' : this.formattedNumericDisplay(field, row, col);
    textRenderer(instance as never, td, row, col, prop as never, display, cellProperties as never);
    td.style.textAlign = 'right';
    return td;
  }

  // Same "ignore the raw cell value, read the canonical one straight from
  // this.rows" approach as numericFieldRenderer above — status is derived
  // (calculateRagStatus) and recomputed in onAfterChange whenever
  // actual/lowest/medium/upper changes, so re-reading from `rows` here
  // (rather than trusting hotData's snapshot from the last rebuildGrid())
  // is what makes that recompute actually show up without a full rebuild.
  private statusCellRenderer(instance: unknown, td: HTMLTableCellElement, row: number, col: number, prop: unknown, _value: unknown, cellProperties: unknown) {
    const period = this.periodAtCoord(row, col);
    const status = period === null ? null : this.rows[period - 1]?.status ?? null;
    textRenderer(instance as never, td, row, col, prop as never, status ?? '', cellProperties as never);
    // Set as custom properties, not td.style.backgroundColor/color directly
    // — this cell is always readOnly (see cellPropsForField), so
    // Handsontable's base renderer always adds 'htDimmed', and its theme
    // CSS colors that class with `!important`, which beats a plain inline
    // style. The ::ng-deep rule in metric-sheet.component.css reads these
    // vars back with its own `!important` (higher-specificity selector) so
    // the RAG fill actually wins; removing them when there's no status lets
    // that rule fall back to the normal dimmed read-only look.
    if (status && STATUS_COLORS[status]) {
      td.style.setProperty('--metric-status-bg', STATUS_COLORS[status]);
      td.style.setProperty('--metric-status-fg', '#fff');
    } else {
      td.style.removeProperty('--metric-status-bg');
      td.style.removeProperty('--metric-status-fg');
    }
    td.style.textAlign = 'center';
    return td;
  }

  private formattedNumericDisplay(field: FieldKey, row: number, col: number): string {
    const period = this.periodAtCoord(row, col);
    if (period === null) return '';
    const stored = this.rows[period - 1]?.[field];
    if (typeof stored !== 'number') return '';
    return formatMetricValue(stored, this.metric.dataType, this.orgCurrency, this.orgUnit, this.decimalPoints);
  }

  private fieldAtCoord(row: number, col: number): FieldKey | null {
    if (this.orientation === 'periods-as-rows') return col >= 2 ? FIELD_KEYS[col - 2] ?? null : null;
    return FIELD_KEYS[row] ?? null;
  }

  // Column headers only carry a renamable field name in 'periods-as-rows'
  // (in 'periods-as-columns' they're period labels — Jan, Feb, ... — so
  // this bails out rather than letting fieldAtCoord's other branch return a
  // wrong field for the row axis it wasn't asked about).
  private onGetColHeader(col: number, th: HTMLElement) {
    if (this.orientation !== 'periods-as-rows') return;
    this.wireHeaderCell(th, this.fieldAtCoord(0, col));
  }

  // Mirror of onGetColHeader for the transposed layout, where field names
  // run down the row-header axis instead.
  private onGetRowHeader(row: number, th: HTMLElement) {
    if (this.orientation !== 'periods-as-columns') return;
    this.wireHeaderCell(th, this.fieldAtCoord(row, 0));
  }

  private periodAtCoord(row: number, col: number): number | null {
    const index = this.orientation === 'periods-as-rows' ? row : col;
    return this.rows[index]?.period ?? null;
  }

  private onAfterChange(changes: unknown[][] | null, source: string) {
    if (!changes || source === 'loadData' || this.readOnly) return;
    let touched = false;
    for (const change of changes) {
      const [row, col, oldVal, newVal] = change as [number, number, unknown, unknown];
      if (oldVal === newVal) continue;
      const field = this.fieldAtCoord(row, col);
      const period = this.periodAtCoord(row, col);
      if (!field || period === null) continue;
      const rowIndex = period - 1;
      const sheetRow = this.rows[rowIndex];
      if (!sheetRow) continue;
      (sheetRow[field] as unknown) = this.coerceValue(field, newVal);
      // Status is never a direct edit target (see cellPropsForField —
      // always readOnly) but every field it's derived from can change here,
      // so recompute it alongside rather than waiting on a save round-trip.
      if (field === 'actual' || field === 'lowest' || field === 'medium' || field === 'upper') {
        sheetRow.status = calculateRagStatus(sheetRow.actual, sheetRow.lowest, sheetRow.medium, sheetRow.upper);
      }
      touched = true;
    }
    if (touched) {
      // Handsontable already redraws the cell(s) it just edited on its own —
      // this covers the Status cell specifically, which was never the edit
      // target itself but needs to reflect the recompute above immediately.
      // No save call here — edits only land in `this.rows` until saveNow()
      // is triggered (tab change/Save button/modal close, see ngOnDestroy
      // and the owning modal), rather than firing an API call per keystroke.
      this.hotTableRef?.hotInstance?.render();
    }
  }

  // `allowInvalid: false` on the numeric cell props (see cellPropsForField)
  // is the real gate against bad paste/fill/typed input — this is just a
  // defensive backstop in case a value ever reaches here some other way
  // (e.g. a future direct data-load path). Status is never reached here at
  // all — it's always readOnly, so Handsontable never fires afterChange
  // for it (see cellPropsForField/onAfterChange).
  private coerceValue(field: FieldKey, raw: unknown): unknown {
    if (field === 'note') return raw == null ? '' : String(raw);
    if (raw === '' || raw === null || raw === undefined) return null;
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    // `raw` here is whatever the editor/paste produced in display scale
    // (the fraction, for a Percentage metric's numeric fields) — convert
    // back to canonical/backend scale before it lands in `this.rows`.
    return this.fromDisplayValue(field, num);
  }

  private toPeriodValue(row: SheetRow): PeriodValue {
    return { actual: row.actual, target: row.target, lowest: row.lowest, medium: row.medium, upper: row.upper, status: row.status, note: row.note };
  }

  private computeDiff(): TrackingDiff {
    const diff: TrackingDiff = {};
    this.rows.forEach((row, i) => {
      const original = this.originalRows[i];
      if (original && !isEqual(this.toPeriodValue(row), this.toPeriodValue(original))) {
        diff[String(row.period)] = this.toPeriodValue(row);
      }
    });
    return diff;
  }

  private doSave(year: number, month: number | null) {
    const diff = this.computeDiff();
    if (Object.keys(diff).length === 0) return of(null);

    this.saving = true;
    this.error = '';
    return this.metricSvc.saveTrackingDiff(this.metric.id, this.metric.frequency, year, month, diff).pipe(
      tap(() => {
        this.originalRows = cloneDeep(this.rows);
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

  // --- Rename columns by clicking their header ---------------------------
  // afterGetColHeader/afterGetRowHeader (wired into every hotSettings object
  // built by rebuildGrid()/rebuildRollupGrid()) fire on every header render
  // — wireHeaderCell() below either attaches a click-to-edit listener to a
  // plain header, or (while editingHeaderField matches) replaces the header
  // cell's content with a live <input>, so the rename happens right in the
  // header itself rather than a separate modal.

  private startHeaderEdit(field: FieldKey) {
    if (this.readOnly || this.editingHeaderField) return;
    this.editingHeaderField = field;
    this.headerDraftValue = this.fieldLabel(field);
    this.headerInputFocused = false;
    this.error = '';
    this.hotTableRef?.hotInstance?.render();
  }

  private cancelHeaderRename() {
    this.editingHeaderField = null;
    this.activeHeaderInput = null;
    this.error = '';
    this.hotTableRef?.hotInstance?.render();
  }

  // Fires on Enter and on blur — guarded by the editingHeaderField check so
  // a blur that follows an already-successful Enter commit (e.g. once the
  // input is removed from the DOM by the render() below) is a harmless no-op
  // rather than a second save attempt.
  private commitHeaderRename(field: FieldKey) {
    if (this.editingHeaderField !== field) return;
    const trimmed = this.headerDraftValue.trim();
    const finalLabel = trimmed || DEFAULT_METRIC_COLUMN_LABELS[field];
    const duplicate = FIELD_KEYS.some((k) => k !== field && this.fieldLabel(k).trim().toLowerCase() === finalLabel.toLowerCase());
    if (duplicate) {
      this.error = `Another column is already named "${finalLabel}" — choose a different name.`;
      // The blur that triggered this commit already moved focus away —
      // reclaim it (next tick, since a browser won't refocus synchronously
      // inside its own blur handler) so the user can just fix the text
      // in place instead of having to click back into the header.
      const input = this.activeHeaderInput;
      if (input) setTimeout(() => { input.focus(); input.select(); });
      return;
    }
    this.error = '';
    this.editingHeaderField = null;
    this.activeHeaderInput = null;
    const current = this.metric.columnLabels?.[field] ?? '';
    if (trimmed === current) {
      this.hotTableRef?.hotInstance?.render();
      return;
    }
    const cleaned: MetricColumnLabels = { ...(this.metric.columnLabels ?? {}) };
    if (trimmed) cleaned[field] = trimmed;
    else delete cleaned[field];
    this.metricSvc.updateMetric(this.metric.id, { columnLabels: Object.keys(cleaned).length ? cleaned : null }).subscribe({
      next: (res) => {
        this.metric = res.metric;
        this.rebuildGrid();
        this.metricUpdated.emit(res.metric);
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to save column name';
        this.rebuildGrid();
      },
    });
  }

  // Only ever called with a header th whose field maps to a renamable
  // column (fieldAtCoord returns null for the Seq/Date/Period columns,
  // which the caller already filters out before reaching here).
  private wireHeaderCell(th: HTMLElement, field: FieldKey | null) {
    if (!field) return;
    if (this.editingHeaderField === field) {
      th.replaceChildren();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'metric-header-rename-input';
      input.maxLength = 40;
      input.value = this.headerDraftValue;
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('input', () => { this.headerDraftValue = input.value; });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.commitHeaderRename(field);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.cancelHeaderRename();
        }
      });
      input.addEventListener('blur', () => this.commitHeaderRename(field));
      this.activeHeaderInput = input;
      th.appendChild(input);
      if (!this.headerInputFocused) {
        this.headerInputFocused = true;
        setTimeout(() => { input.focus(); input.select(); });
      }
      return;
    }
    if (this.readOnly) return;
    th.classList.add('metric-header-renamable');
    th.onclick = () => this.startHeaderEdit(field);
  }
}
