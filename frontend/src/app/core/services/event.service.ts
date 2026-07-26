import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
  CalendarEventModel,
  CalendarOccurrence,
  CreateEventPayload,
  UpdateEventPayload,
  EventListFilters,
  PaginatedEvents,
} from '../../models/event.model';
import { Attachment, DownloadInfo } from '../../models/attachment.model';
import { Observable } from 'rxjs';

// Only 4 backend routes exist (GET/POST /events, PUT/DELETE /events/:id) —
// searchEvents()/getEventsBetween() are thin convenience wrappers over the
// same GET /events (query params only), and duplicateEvent() is a client-
// side copy-then-create, not a dedicated backend "duplicate" endpoint.
@Injectable({ providedIn: 'root' })
export class EventService {
  private readonly api = `${environment.apiUrl}/events`;

  constructor(private http: HttpClient) {}

  getEvents(filters: EventListFilters = {}) {
    return this.http.get<PaginatedEvents>(this.api, { params: this.buildParams(filters) });
  }

  getEventById(eventId: number | string) {
    return this.http.get<CalendarEventModel>(`${this.api}/${eventId}`);
  }

  createEvent(payload: CreateEventPayload) {
    return this.http.post<{ message: string; event: CalendarEventModel }>(this.api, payload);
  }

  updateEvent(eventId: number | string, payload: UpdateEventPayload) {
    return this.http.put<{ message: string; event: CalendarEventModel }>(`${this.api}/${eventId}`, payload);
  }

  deleteEvent(eventId: number | string) {
    return this.http.delete<{ message: string }>(`${this.api}/${eventId}`);
  }

  // originalStart identifies which generated occurrence slot these target
  // (see backend/utils/recurrence.ts) — always URL-encoded since an ISO
  // timestamp's colons would otherwise be parsed as path segment delimiters.
  private occurrencePath(eventId: number | string, originalStart: string) {
    return `${this.api}/${eventId}/occurrences/${encodeURIComponent(originalStart)}`;
  }

  getOccurrence(eventId: number | string, originalStart: string) {
    return this.http.get<CalendarEventModel & CalendarOccurrence>(this.occurrencePath(eventId, originalStart));
  }

  // Edits just this one instance of a recurring series — leaves the master
  // event and every other occurrence untouched.
  updateOccurrence(eventId: number | string, originalStart: string, payload: UpdateEventPayload) {
    return this.http.put<{ message: string; event: CalendarEventModel & CalendarOccurrence }>(
      this.occurrencePath(eventId, originalStart),
      payload
    );
  }

  // Removes just this one instance from the series (the "skip one
  // occurrence" case) — distinct from deleteEvent, which removes the whole
  // series.
  skipOccurrence(eventId: number | string, originalStart: string) {
    return this.http.delete<{ message: string }>(this.occurrencePath(eventId, originalStart));
  }

  searchEvents(query: string, filters: Omit<EventListFilters, 'search'> = {}) {
    return this.getEvents({ ...filters, search: query });
  }

  // The standard "what's visible in this view" query a calendar UI needs —
  // backend does a proper interval-overlap check (start<=end && end>=start),
  // not just "event.start falls inside the range", so multi-day events that
  // started earlier but still overlap are included.
  getEventsBetween(start: string, end: string, filters: Omit<EventListFilters, 'start' | 'end'> = {}) {
    return this.getEvents({ ...filters, start, end });
  }

  // Strips identity/audit fields and re-POSTs the rest — guests, reminders,
  // and recurrence all carry over into the copy.
  duplicateEvent(event: CalendarEventModel) {
    const payload: CreateEventPayload = {
      title: `Copy of ${event.title}`,
      description: event.description,
      location: event.location,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      color: event.color,
      departmentId: event.department?.id ?? null,
      categoryId: event.category?.id ?? null,
      calendarId: event.calendar.id,
      meetingLinkUrl: event.meetingLinkUrl,
      meetingLinkTitle: event.meetingLinkTitle,
      visibility: event.visibility,
      busyStatus: event.busyStatus,
      guests: event.guests.map((g) => ({ email: g.email, name: g.name, userId: g.userId })),
      reminders: event.reminders.map((r) => ({ method: r.method, minutesBefore: r.minutesBefore })),
      recurrence: event.recurrence
        ? {
            frequency: event.recurrence.frequency,
            interval: event.recurrence.interval,
            byWeekday: event.recurrence.byWeekday,
            count: event.recurrence.count,
            until: event.recurrence.until,
          }
        : null,
    };
    return this.createEvent(payload);
  }

  // Attachments — file upload or a pasted link, with a 10s undo-able pending
  // delete, mirroring ProjectService's item-attachment methods.
  getAttachments(eventId: number | string) {
    return this.http.get<Attachment[]>(`${this.api}/${eventId}/attachments`);
  }

  uploadAttachment(eventId: number | string, file: File): Observable<HttpEvent<any>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.api}/${eventId}/attachments`, formData, {
      reportProgress: true,
      observe: 'events',
    });
  }

  addLinkAttachment(eventId: number | string, payload: { url: string; fileName?: string }) {
    return this.http.post<{ message: string; attachment: Attachment }>(
      `${this.api}/${eventId}/attachments/link`,
      payload
    );
  }

  downloadAttachment(eventId: number | string, attachmentId: number) {
    return this.http.get<DownloadInfo>(`${this.api}/${eventId}/attachments/${attachmentId}/download`);
  }

  // Starts the 10s server-side countdown; doesn't delete anything itself.
  deleteAttachment(eventId: number | string, attachmentId: number) {
    return this.http.delete<{ message: string; attachment: Attachment }>(
      `${this.api}/${eventId}/attachments/${attachmentId}`
    );
  }

  undoDeleteAttachment(eventId: number | string, attachmentId: number) {
    return this.http.post<{ message: string; attachment: Attachment }>(
      `${this.api}/${eventId}/attachments/${attachmentId}/undo`,
      {}
    );
  }

  private buildParams(filters: EventListFilters): Record<string, string | number> {
    const params: Record<string, string | number> = {};
    if (filters.start) params['start'] = filters.start;
    if (filters.end) params['end'] = filters.end;
    if (filters.search) params['search'] = filters.search;
    if (filters.calendarId) params['calendarId'] = filters.calendarId;
    if (filters.departmentId) params['departmentId'] = filters.departmentId;
    if (filters.categoryId) params['categoryId'] = filters.categoryId;
    if (filters.page) params['page'] = filters.page;
    if (filters.limit) params['limit'] = filters.limit;
    return params;
  }
}
