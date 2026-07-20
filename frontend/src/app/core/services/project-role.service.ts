import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { ProjectRole, CreateProjectRolePayload, UpdateProjectRolePayload } from '../../models/project-role.model';

@Injectable({ providedIn: 'root' })
export class ProjectRoleService {
  private readonly api = `${environment.apiUrl}/project-roles`;

  constructor(private http: HttpClient) {}

  getRoles() {
    return this.http.get<ProjectRole[]>(this.api);
  }

  createRole(payload: CreateProjectRolePayload) {
    return this.http.post<{ message: string; role: ProjectRole }>(this.api, payload);
  }

  updateRole(id: number, payload: UpdateProjectRolePayload) {
    return this.http.put<{ message: string; role: ProjectRole }>(`${this.api}/${id}`, payload);
  }

  deleteRole(id: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }

  reorderRoles(orderedIds: number[]) {
    return this.http.patch<{ message: string }>(`${this.api}/reorder`, { orderedIds });
  }
}
