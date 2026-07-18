import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CategoryService } from '../../../core/services/category.service';
import { AuthService } from '../../../core/services/auth.service';
import { Category, CategoryDetail } from '../../../models/category.model';
import { CategoryFormComponent, CategoryFormMode, CategoryFormPayload } from '../../../shared/category-form/category-form.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';

type FormMode = CategoryFormMode;

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [RouterLink, CategoryFormComponent, ConfirmDialogComponent],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.css',
})
export class CategoriesComponent implements OnInit {
  readonly isManager: boolean;

  categories: Category[] = [];
  ordered: Category[] = [];
  collapsedIds = new Set<number>();
  private parentMap = new Map<number, number | null>();

  loading = false;
  error = '';

  readonly pageSize = 12;
  currentPage = 1;
  totalItems = 0;
  totalPages = 1;

  selectedId: number | null = null;
  detail: CategoryDetail | null = null;
  detailLoading = false;
  detailError = '';

  formOpen = false;
  formMode: FormMode = 'create';
  editingId: number | null = null;
  formParentId: number | null = null;
  formParentName: string | null = null;
  formInitial: CategoryFormPayload | null = null;
  formLoading = false;
  formError = '';

  confirmOpen = false;
  confirmTarget: Category | null = null;
  confirmLoading = false;

  get confirmMessage(): string {
    if (!this.confirmTarget) return '';
    const suffix = this.confirmTarget.childCount ? ' and all of its sub-categories' : '';
    return `Delete "${this.confirmTarget.name}"${suffix} — this cannot be undone. Projects assigned to it will be unassigned.`;
  }

  constructor(
    private categoryService: CategoryService,
    private auth: AuthService
  ) {
    const role = this.auth.getUser()?.role;
    this.isManager = role === 'Admin' || role === 'Manager';
  }

  ngOnInit() {
    this.loadPage(1);
  }

  loadPage(page: number) {
    if (page < 1 || (page > this.totalPages && this.totalItems > 0)) return;
    this.loading = true;
    this.error = '';
    this.categoryService.getCategoriesPage(page, this.pageSize).subscribe({
      next: (res) => {
        this.categories = res.categories;
        this.currentPage = res.page;
        this.totalItems = res.total;
        this.totalPages = res.totalPages;
        this.rebuildTree();
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load categories';
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

  private rebuildTree() {
    this.parentMap = new Map(this.categories.map((c) => [c.id, c.parentId]));

    const byParent = new Map<number | 'root', Category[]>();
    for (const c of this.categories) {
      const key = c.parentId ?? 'root';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(c);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

    const result: Category[] = [];
    const visit = (key: number | 'root') => {
      for (const child of byParent.get(key) ?? []) {
        result.push(child);
        visit(child.id);
      }
    };
    visit('root');
    this.ordered = result;
  }

  get visibleCategories(): Category[] {
    return this.ordered.filter((c) => !this.hasCollapsedAncestor(c.parentId));
  }

  private hasCollapsedAncestor(parentId: number | null): boolean {
    let current = parentId;
    while (current) {
      if (this.collapsedIds.has(current)) return true;
      current = this.parentMap.get(current) ?? null;
    }
    return false;
  }

  isCollapsed(id: number): boolean {
    return this.collapsedIds.has(id);
  }

  toggleCollapse(id: number, event: Event) {
    event.stopPropagation();
    if (this.collapsedIds.has(id)) this.collapsedIds.delete(id);
    else this.collapsedIds.add(id);
  }

  selectCategory(cat: Category) {
    this.selectedId = cat.id;
    this.detailError = '';
    this.detailLoading = true;
    this.categoryService.getCategoryById(cat.id).subscribe({
      next: (res) => {
        this.detail = res;
        this.detailLoading = false;
      },
      error: (err) => {
        this.detailError = err.error?.message || 'Failed to load category';
        this.detailLoading = false;
      },
    });
  }

  private reloadDetail() {
    if (!this.selectedId) return;
    this.categoryService.getCategoryById(this.selectedId).subscribe({
      next: (res) => (this.detail = res),
      error: () => {},
    });
  }

  openCreate(parent: Category | null) {
    this.formMode = 'create';
    this.editingId = null;
    this.formParentId = parent?.id ?? null;
    this.formParentName = parent?.name ?? null;
    this.formInitial = null;
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(cat: Category, event: Event) {
    event.stopPropagation();
    this.formMode = 'edit';
    this.editingId = cat.id;
    this.formParentId = cat.parentId;
    this.formParentName = null;
    this.formInitial = { name: cat.name, overview: cat.overview, color: cat.color };
    this.formError = '';
    this.formOpen = true;
  }

  closeForm() {
    this.formOpen = false;
    this.formError = '';
  }

  submitForm(payload: CategoryFormPayload) {
    this.formLoading = true;
    this.formError = '';

    const request =
      this.formMode === 'create'
        ? this.categoryService.createCategory({ ...payload, parentId: this.formParentId })
        : this.categoryService.updateCategory(this.editingId!, payload);

    request.subscribe({
      next: () => {
        this.formLoading = false;
        this.closeForm();
        this.loadPage(this.currentPage);
        if (this.formMode === 'edit' && this.selectedId === this.editingId) this.reloadDetail();
      },
      error: (err) => {
        this.formError = err.error?.message || 'Failed to save category';
        this.formLoading = false;
      },
    });
  }

  requestDelete(cat: Category, event: Event) {
    event.stopPropagation();
    this.confirmTarget = cat;
    this.confirmOpen = true;
  }

  closeConfirm() {
    this.confirmOpen = false;
    this.confirmTarget = null;
  }

  confirmDelete() {
    if (!this.confirmTarget) return;
    this.confirmLoading = true;
    this.categoryService.deleteCategory(this.confirmTarget.id).subscribe({
      next: () => {
        this.confirmLoading = false;
        if (this.selectedId === this.confirmTarget!.id) {
          this.selectedId = null;
          this.detail = null;
        }
        this.closeConfirm();
        this.loadPage(this.currentPage);
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to delete category';
        this.confirmLoading = false;
        this.closeConfirm();
      },
    });
  }
}
