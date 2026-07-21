import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  Category,
  CategoryDetail,
  CreateCategoryPayload,
  UpdateCategoryPayload,
  PaginatedCategories,
} from '../../models/category.model';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private readonly api = `${environment.apiUrl}/categories`;

  // Org-wide category list — see DepartmentService.departments for the
  // same lazy-load-once-per-session cache pattern.
  private readonly _categories = signal<Category[]>([]);
  readonly categories = this._categories.asReadonly();
  private loaded = false;

  constructor(private http: HttpClient) {}

  getCategories() {
    return this.http.get<Category[]>(this.api);
  }

  ensureCategoriesLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    this.getCategories().subscribe({
      next: (categories) => this._categories.set(categories),
      error: () => (this.loaded = false),
    });
  }

  // Forces a fresh fetch and updates the shared cache — call after any
  // mutation (create/update/delete) so every other consumer reading
  // `categories` picks up the change without a full page reload.
  refreshCategories() {
    return this.getCategories().pipe(
      tap((categories) => {
        this._categories.set(categories);
        this.loaded = true;
      })
    );
  }

  getCategoriesPage(page: number, limit: number) {
    return this.http.get<PaginatedCategories>(this.api, { params: { page, limit } });
  }

  getCategoryById(id: number) {
    return this.http.get<CategoryDetail>(`${this.api}/${id}`);
  }

  createCategory(payload: CreateCategoryPayload) {
    return this.http.post<{ message: string; category: Category }>(this.api, payload);
  }

  updateCategory(id: number, payload: UpdateCategoryPayload) {
    return this.http.put<{ message: string; category: Category }>(`${this.api}/${id}`, payload);
  }

  deleteCategory(id: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }
}
