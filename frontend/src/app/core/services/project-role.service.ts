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

  updateRole(id: string, payload: UpdateProjectRolePayload) {
    return this.http.put<{ message: string; role: ProjectRole }>(`${this.api}/${id}`, payload);
  }

  deleteRole(id: string) {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }

  reorderRoles(orderedIds: string[]) {
    return this.http.patch<{ message: string }>(`${this.api}/reorder`, { orderedIds });
  }
}
