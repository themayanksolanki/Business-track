import { Component, OnInit, OnDestroy, ViewChild, ElementRef, effect } from '@angular/core';
import { Router } from '@angular/router';
import dayjs from 'dayjs/esm';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';
import { ProjectService } from '../../core/services/project.service';
import { DepartmentService } from '../../core/services/department.service';
import { ProjectsViewService, ProjectsViewMode } from '../../core/services/projects-view.service';
import { Project, CreateProjectPayload } from '../../models/project.model';
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

// Kept deliberately separate from ProjectsComponent (not a mode-flag on the
// same component) even though both list the same underlying Project table —
// a draft is only ever status: 'draft' here, so there's no status-filter row
// to show, and creation always forces status: 'draft' with no dates.
@Component({
  selector: 'app-drafts',
  standalone: true,
  imports: [AppDatePipe, ProjectFormComponent, TagPillComponent],
  templateUrl: './drafts.component.html',
  styleUrl: './drafts.component.css',
})
export class DraftsComponent implements OnInit, OnDestroy {
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
    this.projectService.getProjects(this.cardsPage, this.CARDS_PAGE_SIZE, 'draft').subscribe({
      next: (res) => {
        this.cardsItems = [...this.cardsItems, ...res.projects];
        this.cardsHasMore = this.cardsPage < res.totalPages;
        this.cardsPage++;
        this.cardsLoadingMore = false;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load drafts';
        this.cardsLoadingMore = false;
        this.loading = false;
      },
    });
  }

  loadPage(page: number) {
    if (page < 1 || (page > this.totalPages && this.totalItems > 0)) return;
    this.loading = true;
    this.projectService.getProjects(page, this.pageSize, 'draft').subscribe({
      next: (res) => {
        this.pagedItems = res.projects;
        this.currentPage = res.page;
        this.totalItems = res.total;
        this.totalPages = res.totalPages;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load drafts';
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

  open(draft: Project) {
    this.router.navigate(['/drafts', draft.id]);
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
    this.projectService.createProject({ ...payload, status: 'draft' }).subscribe({
      next: () => {
        this.createLoading = false;
        this.closeCreate();
        this.loadCurrentView();
      },
      error: (err) => {
        this.createError = err.error?.message || 'Failed to create draft';
        this.createLoading = false;
      },
    });
  }
}
