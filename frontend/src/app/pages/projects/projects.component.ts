import { Component, OnInit, OnDestroy, ViewChild, ElementRef, effect } from '@angular/core';
import { Router } from '@angular/router';
import dayjs from 'dayjs/esm';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';
import { ProjectService } from '../../core/services/project.service';
import { DepartmentService } from '../../core/services/department.service';
import { ProjectsViewService, ProjectsViewMode } from '../../core/services/projects-view.service';
import { Project, ProjectStatus, CreateProjectPayload } from '../../models/project.model';
import { Department } from '../../models/department.model';
import { Category } from '../../models/category.model';
import { CategoryService } from '../../core/services/category.service';
import { Tag } from '../../models/tag.model';
import { TagService } from '../../core/services/tag.service';
import { User } from '../../models/user.model';
import { UserService } from '../../core/services/user.service';
import { AuthService } from '../../core/services/auth.service';
import { ProjectFormComponent } from '../../shared/project-form/project-form.component';
import { TagPillComponent } from '../../shared/tag-pill/tag-pill.component';
import { DataTableComponent } from '../../shared/data-table/data-table.component';
import { DataTableCellDirective } from '../../shared/data-table/data-table-cell.directive';
import {
  DataTableColumn,
  DataTableFilterOption,
  DataTableFilterState,
  DataTableSortState,
  toHierarchicalOptions,
} from '../../shared/data-table/data-table.model';

const PRIORITY_OPTIONS: DataTableFilterOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const EFFORT_OPTIONS: DataTableFilterOption[] = PRIORITY_OPTIONS;

const STATUS_OPTIONS: DataTableFilterOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'completed', label: 'Completed' },
  { value: 'draft', label: 'Draft' },
];

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [AppDatePipe, ProjectFormComponent, TagPillComponent, DataTableComponent, DataTableCellDirective],
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.css',
})
export class ProjectsComponent implements OnInit, OnDestroy {
  private readonly CARDS_PAGE_SIZE = 12;
  readonly pageSize = 10; // table/list page size

  loading = false;
  error = '';

  get viewMode() {
    return this.viewSvc.viewMode();
  }

  setViewMode(mode: ProjectsViewMode) {
    this.viewSvc.setViewMode(mode);
  }

  // Status filter tabs — defaults to Active so archived/completed projects
  // don't clutter the default view; "All" opts back into seeing everything.
  statusFilter: ProjectStatus | 'all' = 'active';
  readonly statusFilterOptions: (ProjectStatus | 'all')[] = ['active', 'archived', 'completed', 'all'];

  setStatusFilter(status: ProjectStatus | 'all') {
    if (this.statusFilter === status) return;
    this.statusFilter = status;
    this.loadCurrentView();
  }

  // Only meaningful for "All" — drafts belong to their own Drafts screen and
  // are excluded here by default; this opts back into seeing them mixed in.
  includeDrafts = false;

  toggleIncludeDrafts() {
    this.includeDrafts = !this.includeDrafts;
    this.loadCurrentView();
  }

  statusLabel(status: ProjectStatus | 'all'): string {
    return status === 'all' ? 'All' : status === 'active' ? 'Active' : status === 'archived' ? 'Archived' : 'Completed';
  }

  // Cards view — infinite scroll, accumulates pages
  cardsItems: Project[] = [];
  private cardsPage = 1;
  cardsHasMore = true;
  cardsLoadingMore = false;
  private cardsIntersectionObserver?: IntersectionObserver;

  @ViewChild('sentinel') set sentinelEl(el: ElementRef<HTMLElement> | undefined) {
    this.cardsIntersectionObserver?.disconnect();
    if (!el) return;
    this.cardsIntersectionObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && this.cardsHasMore && !this.cardsLoadingMore) {
        this.loadMoreCards();
      }
    });
    this.cardsIntersectionObserver.observe(el.nativeElement);
  }

  // Table/List views — server-side page-by-page pagination
  pagedItems: Project[] = [];
  currentPage = 1;
  totalItems = 0;
  totalPages = 1;

  // Data table sort/filter — additive to the statusFilter tabs above (the
  // Status column's multiselect just sends `statuses`, which the backend
  // treats as authoritative over the tabs' `status`/`includeDrafts` when
  // present; the tabs keep working exactly as before otherwise).
  sortState: DataTableSortState = { key: null, direction: null };
  filterState: DataTableFilterState = {};

  get columns(): DataTableColumn[] {
    return [
      { key: 'sequenceId', label: 'ID', sortable: true, width: '70px', minWidth: '60px' },
      { key: 'name', label: 'Name', sortable: true, type: 'text', width: '220px', minWidth: '140px' },
      { key: 'owner', label: 'Owner', sortable: true, width: '160px', minWidth: '110px' },
      {
        key: 'department',
        label: 'Department',
        sortable: true,
        type: 'multiselect',
        width: '160px',
        minWidth: '110px',
        options: toHierarchicalOptions(this.departments, (d, depth) => ({
          value: d.id,
          label: d.name,
          color: d.color,
          depth,
        })),
      },
      {
        key: 'category',
        label: 'Category',
        sortable: true,
        type: 'multiselect',
        width: '160px',
        minWidth: '110px',
        options: toHierarchicalOptions(this.categories, (c, depth) => ({
          value: c.id,
          label: c.name,
          color: c.color,
          depth,
        })),
      },
      {
        key: 'tags',
        label: 'Tags',
        type: 'multiselect',
        width: '180px',
        minWidth: '120px',
        options: this.allTags.map((t) => ({ value: t.id, label: t.name, color: t.backgroundColor })),
      },
      { key: 'priority', label: 'Priority', sortable: true, type: 'multiselect', options: PRIORITY_OPTIONS, width: '110px', minWidth: '90px' },
      { key: 'status', label: 'Status', sortable: true, type: 'multiselect', options: STATUS_OPTIONS, width: '110px', minWidth: '90px' },
      { key: 'effort', label: 'Effort', sortable: true, type: 'multiselect', options: EFFORT_OPTIONS, width: '110px', minWidth: '90px' },
      { key: 'startDate', label: 'Start', sortable: true, type: 'date', width: '130px', minWidth: '100px' },
      { key: 'endDate', label: 'End', sortable: true, type: 'date', width: '130px', minWidth: '100px' },
      { key: 'createdBy', label: 'Created By', width: '140px', minWidth: '110px' },
      { key: 'createdAt', label: 'Created', sortable: true, type: 'date', align: 'right', width: '130px', minWidth: '100px' },
    ];
  }

  onSortChange(state: DataTableSortState) {
    this.sortState = state;
    this.loadPage(1);
  }

  onFilterChange(state: DataTableFilterState) {
    this.filterState = state;
    this.loadPage(1);
  }

  // Maps the table's generic sort/filter state onto GET /projects' query
  // param names (see backend/controllers/projectController.ts getProjects).
  private buildQueryParams(): Record<string, string> {
    const params: Record<string, string> = {};

    if (this.sortState.key && this.sortState.direction) {
      params['sortBy'] = this.sortState.key;
      params['sortDir'] = this.sortState.direction;
    }

    const nameFilter = this.filterState['name']?.text?.trim();
    if (nameFilter) params['search'] = nameFilter;

    const multi = (key: string, paramName: string) => {
      const values = this.filterState[key]?.values;
      if (values?.length) params[paramName] = values.join(',');
    };
    multi('department', 'departmentIds');
    multi('category', 'categoryIds');
    multi('tags', 'tagIds');
    multi('priority', 'priorities');
    multi('status', 'statuses');
    multi('effort', 'efforts');

    const dateRange = (key: string, fromParam: string, toParam: string) => {
      const f = this.filterState[key];
      if (f?.dateFrom) params[fromParam] = f.dateFrom;
      if (f?.dateTo) params[toParam] = f.dateTo;
    };
    dateRange('startDate', 'startDateFrom', 'startDateTo');
    dateRange('endDate', 'endDateFrom', 'endDateTo');
    dateRange('createdAt', 'createdAtFrom', 'createdAtTo');

    return params;
  }

  createOpen = false;
  createLoading = false;
  createError = '';

  get departments(): Department[] {
    return this.departmentService.departments();
  }

  get categories(): Category[] {
    return this.categoryService.categories();
  }

  get allTags(): Tag[] {
    return this.tagService.tags();
  }

  get users(): User[] {
    return this.userService.users();
  }

  constructor(
    private projectService: ProjectService,
    private departmentService: DepartmentService,
    private categoryService: CategoryService,
    private tagService: TagService,
    private userService: UserService,
    private viewSvc: ProjectsViewService,
    private router: Router,
    public auth: AuthService
  ) {
    // Reacts to view mode changes from anywhere (e.g. the sidebar's
    // Projects submenu), including the initial value on construction.
    effect(() => {
      this.viewSvc.viewMode();
      this.loadCurrentView();
    });
  }

  ngOnInit() {
    this.departmentService.ensureDepartmentsLoaded();
    this.categoryService.ensureCategoriesLoaded();
    this.tagService.ensureTagsLoaded();
    this.userService.ensureUsersLoaded();
  }

  visibleTags(project: Project) {
    return project.tags.slice(0, 3);
  }

  hiddenTagCount(project: Project): number {
    return Math.max(0, project.tags.length - 3);
  }

  ngOnDestroy() {
    this.cardsIntersectionObserver?.disconnect();
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  private brokenAvatarIds = new Set<number>();

  avatarUrl(user: User): string | null {
    if (this.brokenAvatarIds.has(user.id)) return null;
    return this.auth.avatarUrl(user);
  }

  onAvatarError(user: User) {
    this.brokenAvatarIds.add(user.id);
  }

  /** Reloads whichever view is currently active, from page 1. Called on init,
   *  on view switch, and after any mutation (create/delete) so both view modes
   *  stay correct regardless of which one the user is looking at. */
  private loadCurrentView() {
    this.error = '';
    if (this.viewMode === 'cards') {
      this.cardsItems = [];
      this.cardsPage = 1;
      this.cardsHasMore = true;
      this.loadMoreCards();
    } else {
      this.loadPage(1);
    }
  }

  loadMoreCards() {
    this.cardsLoadingMore = true;
    this.loading = this.cardsItems.length === 0;
    this.projectService
      .getProjects(this.cardsPage, this.CARDS_PAGE_SIZE, this.statusFilter, this.includeDrafts, this.buildQueryParams())
      .subscribe({
        next: (res) => {
          this.cardsItems = [...this.cardsItems, ...res.projects];
          this.cardsHasMore = this.cardsPage < res.totalPages;
          this.cardsPage++;
          this.cardsLoadingMore = false;
          this.loading = false;
        },
        error: (err) => {
          this.error = err.error?.message || 'Failed to load projects';
          this.cardsLoadingMore = false;
          this.loading = false;
        },
      });
  }

  loadPage(page: number) {
    if (page < 1 || (page > this.totalPages && this.totalItems > 0)) return;
    this.loading = true;
    this.projectService.getProjects(page, this.pageSize, this.statusFilter, this.includeDrafts, this.buildQueryParams()).subscribe({
      next: (res) => {
        this.pagedItems = res.projects;
        this.currentPage = res.page;
        this.totalItems = res.total;
        this.totalPages = res.totalPages;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load projects';
        this.loading = false;
      },
    });
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

  get pageStart(): number {
    return this.totalItems === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalItems);
  }

  trackByProjectId = (_: number, project: Project) => project.id;

  open(project: Project) {
    // A draft can surface here via "Include drafts" — route it to the
    // draft-aware detail screen instead of the regular one, which has no
    // status-gating for it (no draft badge, item status/dates aren't locked).
    this.router.navigate([project.status === 'draft' ? '/drafts' : '/projects', project.id]);
  }

  formatRange(startDate: string | null, endDate: string | null): string {
    const start = startDate ? dayjs(startDate).format('MMM D, YYYY') : null;
    const end = endDate ? dayjs(endDate).format('MMM D, YYYY') : null;
    if (start && end) return `${start} – ${end}`;
    return start ?? end ?? '';
  }

  openCreate() {
    this.createError = '';
    this.createOpen = true;
  }

  closeCreate() {
    this.createOpen = false;
    this.createError = '';
  }

  submitCreate(payload: CreateProjectPayload) {
    this.createLoading = true;
    this.createError = '';
    this.projectService.createProject(payload).subscribe({
      next: () => {
        this.createLoading = false;
        this.closeCreate();
        this.loadCurrentView();
      },
      error: (err) => {
        this.createError = err.error?.message || 'Failed to create project';
        this.createLoading = false;
      },
    });
  }
}
