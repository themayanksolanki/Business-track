import { Component, OnInit } from '@angular/core';
import { MetricService } from '../../core/services/metric.service';
import { DepartmentService } from '../../core/services/department.service';
import { CategoryService } from '../../core/services/category.service';
import { UserService } from '../../core/services/user.service';
import { AuthService } from '../../core/services/auth.service';
import { Metric, MetricListItem, MetricStatus, MetricParentLite, CreateMetricPayload, UpdateMetricPayload } from '../../models/metric.model';
import { MetricFormModalComponent, MetricFormMode } from '../../shared/metric-form-modal/metric-form-modal.component';

@Component({
  selector: 'app-metrics',
  standalone: true,
  imports: [MetricFormModalComponent],
  templateUrl: './metrics.component.html',
  styleUrl: './metrics.component.css',
})
export class MetricsComponent implements OnInit {
  metrics: MetricListItem[] = [];
  loading = false;
  error = '';

  readonly pageSize = 20;
  currentPage = 1;
  totalItems = 0;
  totalPages = 1;

  // Defaults to Active so archived/deleted metrics don't clutter the
  // default view — mirrors ProjectsComponent's statusFilter/tabs pattern.
  // No dedicated "Archived" tab: an archived metric is only findable via
  // "All" (still editable back to Active from there) — never given its own
  // browsable tab on this page.
  statusFilter: MetricStatus | 'all' = 'active';
  readonly statusFilterOptions: (MetricStatus | 'all')[] = ['active', 'deleted', 'all'];

  // Flat list of {id, title} for the form's "Parent metric" picker — loaded
  // once, independent of the current status filter/pagination, so a parent
  // choice doesn't disappear just because it's on another page.
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
    this.loadParentOptions();
    this.loadPage(1);
  }

  statusLabel(status: MetricStatus | 'all'): string {
    if (status === 'all') return 'All';
    return status[0].toUpperCase() + status.slice(1);
  }

  setStatusFilter(status: MetricStatus | 'all') {
    if (this.statusFilter === status) return;
    this.statusFilter = status;
    this.loadPage(1);
  }

  loadPage(page: number) {
    if (page < 1 || (page > this.totalPages && this.totalItems > 0)) return;
    this.loading = true;
    this.error = '';
    this.metricService.getMetrics(page, this.pageSize, this.statusFilter).subscribe({
      next: (res) => {
        this.metrics = res.metrics;
        this.currentPage = res.page;
        this.totalItems = res.total;
        this.totalPages = res.totalPages;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load metrics';
        this.loading = false;
      },
    });
  }

  private loadParentOptions() {
    this.metricService.getMetrics(1, 100, 'active').subscribe({
      next: (res) => (this.parentOptions = res.metrics.map((m) => ({ id: m.id, title: m.title }))),
      error: () => {},
    });
  }

  get pageStart(): number {
    return this.totalItems === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalItems);
  }

  get pageNumbers(): number[] {
    const total = this.totalPages;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages: number[] = [1];
    const left = Math.max(2, this.currentPage - 1);
    const right = Math.min(total - 1, this.currentPage + 1);

    if (left > 2) pages.push(-1);
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < total - 1) pages.push(-1);
    pages.push(total);
    return pages;
  }

  openCreate() {
    this.formMode = 'create';
    this.editingId = null;
    this.formInitial = null;
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(row: MetricListItem) {
    this.editingId = row.id;
    this.formError = '';
    this.metricService.getMetricById(row.id).subscribe({
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
        this.loadPage(this.currentPage);
        this.loadParentOptions();
      },
      error: (err) => {
        this.formError = err.error?.message || 'Failed to save metric';
        this.formLoading = false;
      },
    });
  }

  // Soft-delete — sends the same status transition an Admin could otherwise
  // make via the (now button-gated) status flow, just through a dedicated,
  // confirmed action instead of a casual dropdown pick.
  onDeleteConfirmed() {
    if (!this.editingId) return;
    this.deleteLoading = true;
    this.metricService.updateMetric(this.editingId, { status: 'deleted' }).subscribe({
      next: () => {
        this.deleteLoading = false;
        this.closeForm();
        this.loadPage(this.currentPage);
        this.loadParentOptions();
      },
      error: (err) => {
        this.deleteLoading = false;
        this.formError = err.error?.message || 'Failed to delete metric';
      },
    });
  }
}
