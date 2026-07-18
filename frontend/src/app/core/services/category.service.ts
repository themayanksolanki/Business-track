import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

  constructor(private http: HttpClient) {}

  getCategories() {
    return this.http.get<Category[]>(this.api);
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
