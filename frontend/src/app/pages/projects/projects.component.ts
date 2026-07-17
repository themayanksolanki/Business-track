import { Component, OnInit, OnDestroy, ViewChild, ElementRef, effect } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import dayjs from 'dayjs/esm';
import { ProjectService } from '../../core/services/project.service';
import { DepartmentService } from '../../core/services/department.service';
import { ProjectsViewService } from '../../core/services/projects-view.service';
import { Project, CreateProjectPayload } from '../../models/project.model';
import { Department } from '../../models/department.model';
import { Category } from '../../models/category.model';
import { CategoryService } from '../../core/services/category.service';
import { Tag } from '../../models/tag.model';
import { TagService } from '../../core/services/tag.service';
import { User } from '../../models/user.model';
import { UserService } from '../../core/services/user.service';
import { ProjectFormComponent } from '../../shared/project-form/project-form.component';
import { TagPillComponent } from '../../shared/tag-pill/tag-pill.component';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [DatePipe, ProjectFormComponent, TagPillComponent],
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

  departments: Department[] = [];
  categories: Category[] = [];
  allTags: Tag[] = [];
  users: User[] = [];

  constructor(
    private projectService: ProjectService,
    private departmentService: DepartmentService,
    private categoryService: CategoryService,
    private tagService: TagService,
    private userService: UserService,
    private viewSvc: ProjectsViewService,
    private router: Router
  ) {
    // Reacts to view mode changes from anywhere (e.g. the sidebar's
    // Projects submenu), including the initial value on construction.
    effect(() => {
      this.viewSvc.viewMode();
      this.loadCurrentView();
    });
  }

  ngOnInit() {
    this.departmentService.getDepartments().subscribe({
      next: (res) => (this.departments = res),
      error: () => {},
    });
    this.categoryService.getCategories().subscribe({
      next: (res) => (this.categories = res),
      error: () => {},
    });
    this.tagService.getTags().subscribe({
      next: (res) => (this.allTags = res),
      error: () => {},
    });
    this.userService.getAllUsers().subscribe({
      next: (res) => (this.users = res),
      error: () => {},
    });
  }

  onTagCreated(tag: Tag) {
    this.allTags = [...this.allTags, tag];
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
    this.projectService.getProjects(this.cardsPage, this.CARDS_PAGE_SIZE).subscribe({
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
    this.projectService.getProjects(page, this.pageSize).subscribe({
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

  open(project: Project) {
    this.router.navigate(['/projects', project._id]);
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
