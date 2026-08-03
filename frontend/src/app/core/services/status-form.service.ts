import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { StatusForm, CreateStatusFormPayload, UpdateStatusFormPayload } from '../../models/status-form.model';

@Injectable({ providedIn: 'root' })
export class StatusFormService {
  private readonly api = `${environment.apiUrl}/status-forms`;

  private readonly _statusForms = signal<StatusForm[]>([]);
  readonly statusForms = this._statusForms.asReadonly();
  private loaded = false;

  constructor(private http: HttpClient) {}

  getStatusForms() {
    return this.http.get<StatusForm[]>(this.api);
  }

  ensureStatusFormsLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    this.getStatusForms().subscribe({
      next: (forms) => this._statusForms.set(forms),
      error: () => (this.loaded = false),
    });
  }

  refreshStatusForms() {
    return this.getStatusForms().pipe(
      tap((forms) => {
        this._statusForms.set(forms);
        this.loaded = true;
      })
    );
  }

  createStatusForm(payload: CreateStatusFormPayload) {
    return this.http.post<{ message: string; statusForm: StatusForm }>(this.api, payload).pipe(
      tap((res) => this._statusForms.set([res.statusForm, ...this._statusForms()]))
    );
  }

  updateStatusForm(id: number, payload: UpdateStatusFormPayload) {
    return this.http.put<{ message: string; statusForm: StatusForm }>(`${this.api}/${id}`, payload).pipe(
      tap((res) => this._statusForms.set(this._statusForms().map((f) => (f.id === id ? res.statusForm : f))))
    );
  }

  deleteStatusForm(id: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`).pipe(
      tap(() => this._statusForms.set(this._statusForms().filter((f) => f.id !== id)))
    );
  }
}
