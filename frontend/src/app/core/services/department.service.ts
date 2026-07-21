import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  Department,
  DepartmentDetail,
  CreateDepartmentPayload,
  UpdateDepartmentPayload,
  PaginatedDepartments,
} from '../../models/department.model';

@Injectable({ providedIn: 'root' })
export class DepartmentService {
  private readonly api = `${environment.apiUrl}/departments`;

  // Org-wide department list — every project/task page that needs it for a
  // filter/picker used to call getDepartments() independently on every
  // visit; loaded once per session and reused instead, mirroring
  // UserService's users cache.
  private readonly _departments = signal<Department[]>([]);
  readonly departments = this._departments.asReadonly();
  private loaded = false;

  constructor(private http: HttpClient) {}

  getDepartments() {
    return this.http.get<Department[]>(this.api);
  }

  // Lazy shared load — only hits the network the first time any consumer
  // calls this in a session; later calls are no-ops and just read the
  // already-cached signal.
  ensureDepartmentsLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    this.getDepartments().subscribe({
      next: (departments) => this._departments.set(departments),
      error: () => (this.loaded = false), // allow retry on the next call
    });
  }

  // Forces a fresh fetch and updates the shared cache — call after any
  // mutation (create/update/delete) so every other consumer reading
  // `departments` picks up the change without a full page reload.
  refreshDepartments() {
    return this.getDepartments().pipe(
      tap((departments) => {
        this._departments.set(departments);
        this.loaded = true;
      })
    );
  }

  getDepartmentsPage(page: number, limit: number) {
    return this.http.get<PaginatedDepartments>(this.api, { params: { page, limit } });
  }

  getDepartmentById(id: number) {
    return this.http.get<DepartmentDetail>(`${this.api}/${id}`);
  }

  createDepartment(payload: CreateDepartmentPayload) {
    return this.http.post<{ message: string; department: Department }>(this.api, payload);
  }

  updateDepartment(id: number, payload: UpdateDepartmentPayload) {
    return this.http.put<{ message: string; department: Department }>(`${this.api}/${id}`, payload);
  }

  deleteDepartment(id: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }
}
