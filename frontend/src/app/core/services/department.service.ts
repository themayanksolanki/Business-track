import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

  constructor(private http: HttpClient) {}

  getDepartments() {
    return this.http.get<Department[]>(this.api);
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
