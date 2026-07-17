import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
  Project,
  CreateProjectPayload,
  UpdateProjectPayload,
  PaginatedProjects,
} from '../../models/project.model';
import { Attachment } from '../../models/attachment.model';
import {
  ProjectItem,
  CreateProjectItemPayload,
  UpdateProjectItemPayload,
  ProjectItemSummary,
} from '../../models/project-item.model';
import { ProjectComment, CreateCommentPayload } from '../../models/comment.model';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly api = `${environment.apiUrl}/projects`;

  constructor(private http: HttpClient) {}

  // Projects
  getProjects(page: number, limit: number) {
    return this.http.get<PaginatedProjects>(this.api, { params: { page, limit } });
  }

  getProjectById(projectId: string) {
    return this.http.get<Project>(`${this.api}/${projectId}`);
  }

  createProject(payload: CreateProjectPayload) {
    return this.http.post<{ message: string; project: Project }>(this.api, payload);
  }

  updateProject(projectId: string, payload: UpdateProjectPayload) {
    return this.http.put<{ message: string; project: Project }>(`${this.api}/${projectId}`, payload);
  }

  deleteProject(projectId: string) {
    return this.http.delete<{ message: string }>(`${this.api}/${projectId}`);
  }

  // Items
  getItems(projectId: string) {
    return this.http.get<ProjectItem[]>(`${this.api}/${projectId}/items`);
  }

  getItemsSummary(projectId: string) {
    return this.http.get<Record<string, ProjectItemSummary>>(`${this.api}/${projectId}/items/summary`);
  }

  getItemById(projectId: string, itemId: string) {
    return this.http.get<ProjectItem>(`${this.api}/${projectId}/items/${itemId}`);
  }

  createItem(projectId: string, payload: CreateProjectItemPayload) {
    return this.http.post<{ message: string; item: ProjectItem }>(
      `${this.api}/${projectId}/items`,
      payload
    );
  }

  updateItem(projectId: string, itemId: string, payload: UpdateProjectItemPayload) {
    return this.http.put<{ message: string; item: ProjectItem }>(
      `${this.api}/${projectId}/items/${itemId}`,
      payload
    );
  }

  deleteItem(projectId: string, itemId: string) {
    return this.http.delete<{ message: string }>(`${this.api}/${projectId}/items/${itemId}`);
  }

  reorderItems(projectId: string, parentId: string | null, orderedIds: string[]) {
    return this.http.patch<{ message: string }>(`${this.api}/${projectId}/items/reorder`, {
      parentId,
      orderedIds,
    });
  }

  moveItem(projectId: string, itemId: string, direction: 'up' | 'down' | 'indent' | 'outdent') {
    return this.http.patch<{ message: string; item: ProjectItem }>(
      `${this.api}/${projectId}/items/${itemId}/move`,
      { direction }
    );
  }

  moveItemToParent(projectId: string, itemId: string, parentId: string | null, index?: number) {
    return this.http.patch<{ message: string; item: ProjectItem }>(
      `${this.api}/${projectId}/items/${itemId}/move-to`,
      { parentId, index }
    );
  }

  bulkMoveItemsToParent(projectId: string, itemIds: string[], parentId: string) {
    return this.http.patch<{ message: string; movedCount: number; alreadyInGroupCount: number }>(
      `${this.api}/${projectId}/items/bulk-move-to`,
      { itemIds, parentId }
    );
  }

  // Comments
  getComments(projectId: string, itemId: string) {
    return this.http.get<ProjectComment[]>(`${this.api}/${projectId}/items/${itemId}/comments`);
  }

  addComment(projectId: string, itemId: string, payload: CreateCommentPayload) {
    return this.http.post<{ message: string; comment: ProjectComment }>(
      `${this.api}/${projectId}/items/${itemId}/comments`,
      payload
    );
  }

  deleteComment(projectId: string, itemId: string, commentId: string) {
    return this.http.delete<{ message: string }>(
      `${this.api}/${projectId}/items/${itemId}/comments/${commentId}`
    );
  }

  // Attachments
  getAttachments(projectId: string, itemId: string) {
    return this.http.get<Attachment[]>(`${this.api}/${projectId}/items/${itemId}/attachments`);
  }

  uploadAttachment(projectId: string, itemId: string, file: File): Observable<HttpEvent<any>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.api}/${projectId}/items/${itemId}/attachments`, formData, {
      reportProgress: true,
      observe: 'events',
    });
  }

  downloadAttachment(projectId: string, itemId: string, attachmentId: string) {
    return this.http.get(`${this.api}/${projectId}/items/${itemId}/attachments/${attachmentId}/download`, {
      responseType: 'blob',
    });
  }

  deleteAttachment(projectId: string, itemId: string, attachmentId: string) {
    return this.http.delete<{ message: string }>(
      `${this.api}/${projectId}/items/${itemId}/attachments/${attachmentId}`
    );
  }

  // Project-level attachments (Details tab)
  getProjectAttachments(projectId: string) {
    return this.http.get<Attachment[]>(`${this.api}/${projectId}/attachments`);
  }

  uploadProjectAttachment(projectId: string, file: File): Observable<HttpEvent<any>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.api}/${projectId}/attachments`, formData, {
      reportProgress: true,
      observe: 'events',
    });
  }

  downloadProjectAttachment(projectId: string, attachmentId: string) {
    return this.http.get(`${this.api}/${projectId}/attachments/${attachmentId}/download`, {
      responseType: 'blob',
    });
  }

  deleteProjectAttachment(projectId: string, attachmentId: string) {
    return this.http.delete<{ message: string }>(`${this.api}/${projectId}/attachments/${attachmentId}`);
  }

  // Project plan (Details tab)
  uploadProjectPlan(projectId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.put<{ message: string; project: Project }>(`${this.api}/${projectId}/plan`, formData);
  }

  downloadProjectPlan(projectId: string) {
    return this.http.get(`${this.api}/${projectId}/plan/download`, { responseType: 'blob' });
  }

  removeProjectPlan(projectId: string) {
    return this.http.delete<{ message: string; project: Project }>(`${this.api}/${projectId}/plan`);
  }
}
