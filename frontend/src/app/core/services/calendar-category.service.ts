import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CalendarCategory, CreateCalendarCategoryPayload, UpdateCalendarCategoryPayload } from '../../models/calendar-category.model';

@Injectable({ providedIn: 'root' })
export class CalendarCategoryService {
  private readonly api = `${environment.apiUrl}/calendar-categories`;

  constructor(private http: HttpClient) {}

  getCategories() {
    return this.http.get<CalendarCategory[]>(this.api);
  }

  createCategory(payload: CreateCalendarCategoryPayload) {
    return this.http.post<{ message: string; category: CalendarCategory }>(this.api, payload);
  }

  updateCategory(id: number, payload: UpdateCalendarCategoryPayload) {
    return this.http.put<{ message: string; category: CalendarCategory }>(`${this.api}/${id}`, payload);
  }

  deleteCategory(id: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }
}
