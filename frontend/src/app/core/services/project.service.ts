import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
  Project,
  ProjectStatus,
  ProjectDetailsLayoutEntry,
  CreateProjectPayload,
  UpdateProjectPayload,
  PaginatedProjects,
} from '../../models/project.model';
import { Attachment, DownloadInfo } from '../../models/attachment.model';
import {
  ProjectItem,
  CreateProjectItemPayload,
  UpdateProjectItemPayload,
  ProjectItemSummary,
} from '../../models/project-item.model';
import { ProjectComment, CreateCommentPayload, UpdateCommentPayload } from '../../models/comment.model';
import { ProjectMember } from '../../models/project.model';
import { PaginatedUsers } from '../../models/user.model';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly api = `${environment.apiUrl}/projects`;

  constructor(private http: HttpClient) {}

  // The /download endpoints hand back a viewUrl (inline disposition, for
  // direct <img>/<video>/<iframe> src) and a downloadUrl (attachment
  // disposition, for a forced Save As) — a presigned S3 URL or Cloudinary's
  // already-public one, never the file bytes.
  private getFileInfo(downloadInfoUrl: string) {
    return this.http.get<DownloadInfo>(downloadInfoUrl);
  }

  // Projects
  // `extra` carries the data table's sort/filter query params (sortBy,
  // sortDir, search, statuses, priorities, efforts, departmentIds,
  // categoryIds, tagIds, and the *From/*To date-range pairs) — kept as a
  // free-form map here rather than named params so new filterable columns
  // don't require touching this signature again.
  getProjects(
    page: number,
    limit: number,
    status?: ProjectStatus | 'all',
    includeDrafts = false,
    extra?: Record<string, string>
  ) {
    const params: Record<string, string | number> = { page, limit, ...extra };
    if (status && status !== 'all') params['status'] = status;
    if (includeDrafts) params['includeDrafts'] = 'true';
    return this.http.get<PaginatedProjects>(this.api, { params });
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

  // Resolves the "Copy Project Link" reference (org + per-org sequence
  // number, not the raw numeric id) — deliberately not gated the same way
  // as getProjectById; see getSharedProject's comment in the backend
  // controller. hasNormalAccess tells the caller whether to redirect to the
  // fully-featured /projects/:id route instead of rendering read-only.
  resolveSharedProject(organizationId: number, sequenceId: number) {
    return this.http.get<{ project: Project; hasNormalAccess: boolean }>(
      `${this.api}/shared/${organizationId}/${sequenceId}`
    );
  }

  getSharedItems(organizationId: number, sequenceId: number) {
    return this.http.get<ProjectItem[]>(`${this.api}/shared/${organizationId}/${sequenceId}/items`);
  }

  // Shared Details-tab card layout (order + resize) — its own endpoint since
  // any project member may rearrange it, unlike the settings fields gated
  // behind updateProject's manage-permission check.
  updateDetailsLayout(projectId: string, detailsLayout: ProjectDetailsLayoutEntry[]) {
    return this.http.patch<{ message: string; project: Project }>(
      `${this.api}/${projectId}/details-layout`,
      { detailsLayout }
    );
  }

  // Items
  getItems(projectId: string) {
    return this.http.get<ProjectItem[]>(`${this.api}/${projectId}/items`);
  }

  getItemsSummary(projectId: string) {
    return this.http.get<Record<string, ProjectItemSummary>>(`${this.api}/${projectId}/items/summary`);
  }

  getItemById(projectId: string, itemId: number) {
    return this.http.get<ProjectItem>(`${this.api}/${projectId}/items/${itemId}`);
  }

  createItem(projectId: string, payload: CreateProjectItemPayload) {
    return this.http.post<{ message: string; item: ProjectItem }>(
      `${this.api}/${projectId}/items`,
      payload
    );
  }

  updateItem(projectId: string, itemId: number, payload: UpdateProjectItemPayload) {
    return this.http.put<{ message: string; item: ProjectItem }>(
      `${this.api}/${projectId}/items/${itemId}`,
      payload
    );
  }

  deleteItem(projectId: string, itemId: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${projectId}/items/${itemId}`);
  }

  duplicateItem(projectId: string, itemId: number) {
    return this.http.post<{ message: string; item: ProjectItem }>(
      `${this.api}/${projectId}/items/${itemId}/duplicate`,
      {}
    );
  }

  reorderItems(projectId: string, parentId: number | null, orderedIds: number[]) {
    return this.http.patch<{ message: string }>(`${this.api}/${projectId}/items/reorder`, {
      parentId,
      orderedIds,
    });
  }

  moveItem(projectId: string, itemId: number, direction: 'up' | 'down' | 'indent' | 'outdent') {
    return this.http.patch<{ message: string; item: ProjectItem }>(
      `${this.api}/${projectId}/items/${itemId}/move`,
      { direction }
    );
  }

  moveItemToParent(projectId: string, itemId: number, parentId: number | null, index?: number) {
    return this.http.patch<{ message: string; item: ProjectItem }>(
      `${this.api}/${projectId}/items/${itemId}/move-to`,
      { parentId, index }
    );
  }

  bulkMoveItemsToParent(projectId: string, itemIds: number[], parentId: number) {
    return this.http.patch<{ message: string; movedCount: number; alreadyInGroupCount: number }>(
      `${this.api}/${projectId}/items/bulk-move-to`,
      { itemIds, parentId }
    );
  }

  // Re-homes an item (and its whole subtree) into a different project.
  // targetParentId is the destination group/task/subtask to nest it under —
  // omit it (or pass null) only when moving a group, which always lands at
  // the destination project's root.
  moveItemToProject(projectId: string, itemId: number, targetProjectId: number, targetParentId: number | null) {
    return this.http.patch<{ message: string; item: ProjectItem }>(
      `${this.api}/${projectId}/items/${itemId}/move-to-project`,
      { targetProjectId, targetParentId }
    );
  }

  // Bulk counterpart — tasks only (groups aren't supported, matching the
  // selection UI: the checkbox for bulk-select only ever appears on depth-1
  // task rows), so targetParentId is always required, unlike the
  // single-item version which allows null for a group moving to the
  // target's root.
  bulkMoveItemsToProject(projectId: string, itemIds: number[], targetProjectId: number, targetParentId: number) {
    return this.http.patch<{ message: string; movedCount: number; skippedCount: number }>(
      `${this.api}/${projectId}/items/bulk-move-to-project`,
      { itemIds, targetProjectId, targetParentId }
    );
  }

  // Comments
  getComments(projectId: string, itemId: number) {
    return this.http.get<ProjectComment[]>(`${this.api}/${projectId}/items/${itemId}/comments`);
  }

  addComment(projectId: string, itemId: number, payload: CreateCommentPayload) {
    return this.http.post<{ message: string; comment: ProjectComment }>(
      `${this.api}/${projectId}/items/${itemId}/comments`,
      payload
    );
  }

  updateComment(projectId: string, itemId: number, commentId: number, payload: UpdateCommentPayload) {
    return this.http.patch<{ message: string; comment: ProjectComment }>(
      `${this.api}/${projectId}/items/${itemId}/comments/${commentId}`,
      payload
    );
  }

  deleteComment(projectId: string, itemId: number, commentId: number) {
    return this.http.delete<{ message: string }>(
      `${this.api}/${projectId}/items/${itemId}/comments/${commentId}`
    );
  }

  // Attachments
  getAttachments(projectId: string, itemId: number) {
    return this.http.get<Attachment[]>(`${this.api}/${projectId}/items/${itemId}/attachments`);
  }

  uploadAttachment(projectId: string, itemId: number, file: File): Observable<HttpEvent<any>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.api}/${projectId}/items/${itemId}/attachments`, formData, {
      reportProgress: true,
      observe: 'events',
    });
  }

  addLinkAttachment(projectId: string, itemId: number, payload: { url: string; fileName?: string }) {
    return this.http.post<{ message: string; attachment: Attachment }>(
      `${this.api}/${projectId}/items/${itemId}/attachments/link`,
      payload
    );
  }

  downloadAttachment(projectId: string, itemId: number, attachmentId: number) {
    return this.getFileInfo(`${this.api}/${projectId}/items/${itemId}/attachments/${attachmentId}/download`);
  }

  // Starts the 10s server-side countdown; doesn't delete anything itself.
  deleteAttachment(projectId: string, itemId: number, attachmentId: number) {
    return this.http.delete<{ message: string; attachment: Attachment }>(
      `${this.api}/${projectId}/items/${itemId}/attachments/${attachmentId}`
    );
  }

  undoDeleteAttachment(projectId: string, itemId: number, attachmentId: number) {
    return this.http.post<{ message: string; attachment: Attachment }>(
      `${this.api}/${projectId}/items/${itemId}/attachments/${attachmentId}/undo`,
      {}
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

  downloadProjectAttachment(projectId: string, attachmentId: number) {
    return this.getFileInfo(`${this.api}/${projectId}/attachments/${attachmentId}/download`);
  }

  deleteProjectAttachment(projectId: string, attachmentId: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${projectId}/attachments/${attachmentId}`);
  }

  // Project plan (Details tab)
  uploadProjectPlan(projectId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.put<{ message: string; project: Project }>(`${this.api}/${projectId}/plan`, formData);
  }

  downloadProjectPlan(projectId: string) {
    return this.getFileInfo(`${this.api}/${projectId}/plan/download`);
  }

  removeProjectPlan(projectId: string) {
    return this.http.delete<{ message: string; project: Project }>(`${this.api}/${projectId}/plan`);
  }

  // Members (Teams tab)
  getMembers(projectId: string) {
    return this.http.get<ProjectMember[]>(`${this.api}/${projectId}/members`);
  }

  // Only called when the "Add Member" dropdown is opened — never on Project
  // Details load, which already gets members+roles from getProjectById.
  getMemberCandidates(projectId: string, page: number, limit: number, search?: string) {
    const params: Record<string, string | number> = { page, limit };
    if (search) params['search'] = search;
    return this.http.get<PaginatedUsers>(`${this.api}/${projectId}/members/candidates`, { params });
  }

  addMember(projectId: string, userId: number, roleId: number) {
    return this.http.post<{ message: string; members: ProjectMember[] }>(
      `${this.api}/${projectId}/members`,
      { userId, roleId }
    );
  }

  updateMemberRole(projectId: string, memberId: number, roleId: number) {
    return this.http.patch<{ message: string; members: ProjectMember[] }>(
      `${this.api}/${projectId}/members/${memberId}`,
      { roleId }
    );
  }

  removeMember(projectId: string, memberId: number) {
    return this.http.delete<{ message: string; members: ProjectMember[] }>(
      `${this.api}/${projectId}/members/${memberId}`
    );
  }
}
