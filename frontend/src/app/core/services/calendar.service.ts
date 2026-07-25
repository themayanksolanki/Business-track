import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Calendar, CreateCalendarPayload, UpdateCalendarPayload } from '../../models/calendar.model';

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private readonly api = `${environment.apiUrl}/calendars`;

  // Shared across the calendar-page sidebar and the event dialog's picker —
  // see CategoryService.categories for the same lazy-load-once-per-session
  // cache pattern.
  private readonly _calendars = signal<Calendar[]>([]);
  readonly calendars = this._calendars.asReadonly();
  private loaded = false;

  constructor(private http: HttpClient) {}

  getCalendars() {
    return this.http.get<Calendar[]>(this.api);
  }

  ensureCalendarsLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    this.getCalendars().subscribe({
      next: (calendars) => this._calendars.set(calendars),
      error: () => (this.loaded = false),
    });
  }

  // Forces a fresh fetch and updates the shared cache — call after any
  // mutation (create/update/delete) so every other consumer reading
  // `calendars` picks up the change without a full page reload.
  refreshCalendars() {
    return this.getCalendars().pipe(
      tap((calendars) => {
        this._calendars.set(calendars);
        this.loaded = true;
      })
    );
  }

  createCalendar(payload: CreateCalendarPayload) {
    return this.http.post<{ message: string; calendar: Calendar }>(this.api, payload);
  }

  updateCalendar(id: number, payload: UpdateCalendarPayload) {
    return this.http.put<{ message: string; calendar: Calendar }>(`${this.api}/${id}`, payload);
  }

  deleteCalendar(id: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }
}
