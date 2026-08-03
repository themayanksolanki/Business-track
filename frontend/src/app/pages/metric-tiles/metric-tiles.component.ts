import { Component, OnInit } from '@angular/core';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { NgbPopover } from '@ng-bootstrap/ng-bootstrap';
import { MetricInfoPopoverComponent } from '../../shared/metric-info-popover/metric-info-popover.component';
import { MetricService } from '../../core/services/metric.service';
import { DepartmentService } from '../../core/services/department.service';
import { CategoryService } from '../../core/services/category.service';
import { UserService } from '../../core/services/user.service';
import { AuthService } from '../../core/services/auth.service';
import {
  Metric,
  MetricTileItem,
  MetricDataType,
  MetricParentLite,
  CreateMetricPayload,
  UpdateMetricPayload,
} from '../../models/metric.model';
import { MetricFormModalComponent, MetricFormMode } from '../../shared/metric-form-modal/metric-form-modal.component';
import { GaugeChartComponent } from '../../shared/gauge-chart/gauge-chart.component';
import { TrendChartComponent, TrendChartSeries } from '../../shared/trend-chart/trend-chart.component';
import { currentPeriodInfo } from '../../shared/utils/metric-period.util';
import { TREND_ACTUAL_COLOR, TREND_TARGET_COLOR, trendPeriodLabel, trendWindow } from '../../shared/utils/metric-trend.util';
import { formatMetricValue, percentOfTarget, canEditMetricListItem } from '../../shared/utils/metric-value.util';

const DEFAULT_DECIMAL_POINTS = 2;
// Same trailing-window size as the metric-form-modal's Statistics tab.
const TREND_POINTS = 10;

interface TileRow {
  item: MetricTileItem;
  actual: number | null;
  target: number | null;
  loading: boolean;
  error: string;
  // Which visualization the tile currently shows — flipped via the on-hover
  // triangle buttons. Trend data is only fetched the first time a tile is
  // flipped to 'trend', not upfront for every tile.
  view: 'gauge' | 'trend';
  trendCategories: string[];
  trendSeries: TrendChartSeries[];
  trendLoading: boolean;
  trendError: string;
  trendLoaded: boolean;
}

interface TileGroup {
  // null => the root/top-level sibling group.
  parentId: number | null;
  parentTitle: string | null;
  rows: TileRow[];
}

@Component({
  selector: 'app-metric-tiles',
  standalone: true,
  imports: [DragDropModule, MetricFormModalComponent, GaugeChartComponent, TrendChartComponent, NgbPopover, MetricInfoPopoverComponent],
  templateUrl: './metric-tiles.component.html',
  styleUrl: './metric-tiles.component.css',
})
export class MetricTilesComponent implements OnInit {
  groups: TileGroup[] = [];
  loading = false;
  error = '';

  // Only shown once there's more than one sibling group — the common case
  // (no metric hierarchy in use) stays a clean, heading-less grid.
  get showGroupHeadings(): boolean {
    return this.groups.length > 1;
  }

  parentOptions: MetricParentLite[] = [];

  formOpen = false;
  formMode: MetricFormMode = 'create';
  editingId: number | null = null;
  formInitial: Metric | null = null;
  formLoading = false;
  formError = '';
  deleteLoading = false;

  constructor(
    private metricService: MetricService,
    public departmentService: DepartmentService,
    public categoryService: CategoryService,
    public userService: UserService,
    public auth: AuthService
  ) {}

  ngOnInit() {
    this.departmentService.ensureDepartmentsLoaded();
    this.categoryService.ensureCategoriesLoaded();
    this.userService.ensureUsersLoaded();
    this.loadTiles();
  }

  private loadTiles() {
    this.loading = true;
    this.error = '';
    this.metricService.getMetricTiles().subscribe({
      next: (items) => {
        this.groups = this.groupItems(items);
        this.parentOptions = items.map((m) => ({ id: m.id, title: m.title }));
        this.loading = false;
        this.loadAllTotals();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load metrics';
        this.loading = false;
      },
    });
  }

  // Groups already arrive pre-sorted by (parentId, order) from the backend —
  // this just buckets them without disturbing that order. The root group
  // (parentId null) always renders first when present.
  private groupItems(items: MetricTileItem[]): TileGroup[] {
    const byParent = new Map<number | null, TileRow[]>();
    const parentOrder: (number | null)[] = [];

    for (const item of items) {
      const key = item.parentId;
      if (!byParent.has(key)) {
        byParent.set(key, []);
        parentOrder.push(key);
      }
      byParent.get(key)!.push({
        item,
        actual: null,
        target: null,
        loading: true,
        error: '',
        view: 'gauge',
        trendCategories: [],
        trendSeries: [],
        trendLoading: false,
        trendError: '',
        trendLoaded: false,
      });
    }

    parentOrder.sort((a, b) => (a === null ? -1 : b === null ? 1 : 0));

    return parentOrder.map((parentId) => {
      const rows = byParent.get(parentId)!;
      return {
        parentId,
        parentTitle: parentId === null ? null : (rows[0].item.parent?.title ?? null),
        rows,
      };
    });
  }

  private loadAllTotals() {
    const now = new Date();
    for (const group of this.groups) {
      for (const row of group.rows) this.loadTotalsFor(row, now);
    }
  }

  private loadTotalsFor(row: TileRow, now: Date) {
    const { year, month } = currentPeriodInfo(row.item.frequency, now);
    row.loading = true;
    row.error = '';
    this.metricService.getTracking(row.item.id, row.item.frequency, year, month).subscribe({
      next: (data) => {
        row.actual = data.actualTotal;
        row.target = data.targetTotal;
        row.loading = false;
      },
      error: (err) => {
        row.error = err.error?.message || 'Failed to load';
        row.loading = false;
      },
    });
  }

  percentFor(row: TileRow): number | null {
    return percentOfTarget(row.actual, row.target);
  }

  // A Viewer team member shouldn't be able to drag-reorder a tile they
  // can't edit — mirrors the backend's own per-sibling canEditMetric check
  // in reorderMetrics.
  canEditTile(row: TileRow): boolean {
    return canEditMetricListItem(this.auth.currentUser(), row.item);
  }

  // organization is typed loosely (Organization | number | null) since some
  // payloads elsewhere reference it by bare id — currentUser() always
  // carries the full nested object in practice (see authController.ts's
  // toUserShape()), so narrow out the id-only case defensively.
  formatValue(value: number | null, dataType: MetricDataType): string {
    const rawOrg = this.auth.currentUser()?.organization;
    const org = rawOrg && typeof rawOrg === 'object' ? rawOrg : null;
    return formatMetricValue(value, dataType, org?.currency ?? 'USD', org?.unit ?? 'KG', this.decimalPoints);
  }

  private get decimalPoints(): number {
    return this.auth.currentUser()?.decimalPoints ?? DEFAULT_DECIMAL_POINTS;
  }

  showGauge(row: TileRow) {
    row.view = 'gauge';
  }

  showTrend(row: TileRow) {
    row.view = 'trend';
    if (!row.trendLoaded && !row.trendLoading) this.loadTrendFor(row);
  }

  // Both hover triangles do the same thing — with exactly two views there's
  // no real "forward"/"back", just flip to whichever isn't showing.
  toggleView(row: TileRow) {
    if (row.view === 'gauge') this.showTrend(row);
    else this.showGauge(row);
  }

  private loadTrendFor(row: TileRow) {
    const { year, month, period: currentPeriod } = currentPeriodInfo(row.item.frequency, new Date());

    row.trendLoading = true;
    row.trendError = '';
    this.metricService.getTracking(row.item.id, row.item.frequency, year, month).subscribe({
      next: (data) => {
        const periodNums = trendWindow(currentPeriod, TREND_POINTS);
        row.trendCategories = periodNums.map((p) => trendPeriodLabel(row.item.frequency, p, year));
        row.trendSeries = [
          { name: 'Actual', color: TREND_ACTUAL_COLOR, data: periodNums.map((p) => data.periods[String(p)]?.actual ?? null) },
          { name: 'Target', color: TREND_TARGET_COLOR, data: periodNums.map((p) => data.periods[String(p)]?.target ?? null) },
        ];
        row.trendLoading = false;
        row.trendLoaded = true;
      },
      error: (err) => {
        row.trendError = err.error?.message || 'Failed to load trend data';
        row.trendLoading = false;
      },
    });
  }

  onDrop(group: TileGroup, event: CdkDragDrop<TileRow[]>) {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(group.rows, event.previousIndex, event.currentIndex);
    const orderedIds = group.rows.map((r) => r.item.id);
    this.metricService.reorderMetrics(group.parentId, orderedIds).subscribe({
      error: () => this.loadTiles(),
    });
  }

  openCreate() {
    this.formMode = 'create';
    this.editingId = null;
    this.formInitial = null;
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(row: TileRow) {
    this.editingId = row.item.id;
    this.formError = '';
    this.metricService.getMetricById(row.item.id).subscribe({
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

    const request =
      this.formMode === 'create'
        ? this.metricService.createMetric(payload as CreateMetricPayload)
        : this.metricService.updateMetric(this.editingId!, payload as UpdateMetricPayload);

    request.subscribe({
      next: () => {
        this.formLoading = false;
        this.closeForm();
        this.loadTiles();
      },
      error: (err) => {
        this.formError = err.error?.message || 'Failed to save metric';
        this.formLoading = false;
      },
    });
  }

  onDeleteConfirmed() {
    if (!this.editingId) return;
    this.deleteLoading = true;
    this.metricService.updateMetric(this.editingId, { status: 'deleted' }).subscribe({
      next: () => {
        this.deleteLoading = false;
        this.closeForm();
        this.loadTiles();
      },
      error: (err) => {
        this.deleteLoading = false;
        this.formError = err.error?.message || 'Failed to delete metric';
      },
    });
  }
}
