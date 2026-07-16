import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import dayjs from 'dayjs/esm';
import { ProjectService } from '../../core/services/project.service';
import { DepartmentService } from '../../core/services/department.service';
import { Project } from '../../models/project.model';
import { Department } from '../../models/department.model';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { TimePickerComponent } from '../../shared/time-picker/time-picker.component';
import { ModalDirective } from '../../shared/modal.directive';

export type ProjectsViewMode = 'cards' | 'table' | 'list';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, DatePickerComponent, TimePickerComponent, ModalDirective],
  templateUrl: './projects.component.html',
  styleUrl: './projects.component.css',
})
export class ProjectsComponent implements OnInit, OnDestroy {
  private readonly VIEW_KEY = 'projects-view-mode';
  private readonly CARDS_PAGE_SIZE = 12;
  readonly pageSize = 10; // table/list page size

  loading = false;
  error = '';
  viewMode: ProjectsViewMode = 'list';

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
  createForm: FormGroup;
  createLoading = false;
  createError = '';

  createStartDate: string | null = null;
  createStartTime: string | null = null;
  createEndDate: string | null = null;
  createEndTime: string | null = null;

  departments: Department[] = [];

  constructor(
    private fb: FormBuilder,
    private projectService: ProjectService,
    private departmentService: DepartmentService,
    private router: Router
  ) {
    this.createForm = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      department: [''],
    });

    const savedView = localStorage.getItem(this.VIEW_KEY);
    if (savedView === 'cards' || savedView === 'table' || savedView === 'list') {
      this.viewMode = savedView;
    }
  }

  ngOnInit() {
    this.loadCurrentView();
    this.departmentService.getDepartments().subscribe({
      next: (res) => (this.departments = res),
      error: () => {},
    });
  }

  ngOnDestroy() {
    this.cardsIntersectionObserver?.disconnect();
  }

  setViewMode(mode: ProjectsViewMode) {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    localStorage.setItem(this.VIEW_KEY, mode);
    this.loadCurrentView();
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
    this.createForm.reset({ name: '', description: '', department: '' });
    this.createStartDate = null;
    this.createStartTime = null;
    this.createEndDate = null;
    this.createEndTime = null;
    this.createError = '';
    this.createOpen = true;
  }

  closeCreate() {
    this.createOpen = false;
    this.createError = '';
  }

  private combineDateTime(date: string | null, time: string | null): string | null {
    if (!date) return null;
    return dayjs(`${date} ${time || '00:00'}`, 'YYYY-MM-DD HH:mm').toISOString();
  }

  submitCreate() {
    if (this.createForm.invalid) return;
    this.createLoading = true;
    this.createError = '';
    const payload = {
      ...this.createForm.value,
      department: this.createForm.value.department || null,
      startDate: this.combineDateTime(this.createStartDate, this.createStartTime),
      endDate: this.combineDateTime(this.createEndDate, this.createEndTime),
    };
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
