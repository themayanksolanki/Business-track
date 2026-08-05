import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  Project,
  ProjectStatus,
  ProjectDetailsLayoutEntry,
  CreateProjectPayload,
  UpdateProjectPayload,
  PaginatedProjects,
  PaginatedProjectPickerRows,
  ProjectStats,
} from '../../models/project.model';
import { Attachment, AttachmentsAdapter, DownloadInfo } from '../../models/attachment.model';
import { LinkedEvent } from '../../models/event.model';
import {
  ProjectItem,
  CreateProjectItemPayload,
  UpdateProjectItemPayload,
  ProjectItemSummary,
  ProjectItemPickerRow,
} from '../../models/project-item.model';
import { ProjectComment, CreateCommentPayload, UpdateCommentPayload } from '../../models/comment.model';
import { ProjectMember } from '../../models/project.model';
import { PaginatedUsers } from '../../models/user.model';
import { Meeting } from '../../models/meeting.model';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly api = `${environment.apiUrl}/projects`;

  // Shared, unfiltered/unpaginated project-list cache — distinct from the
  // Projects/Drafts pages' own paginated per-view state (which only ever
  // holds one page or an accumulating cards buffer, never the full list).
  // Consumers (e.g. the Project Detail page's overlay sidebar) read this
  // instead of firing their own request; kept in sync by create/update/
  // delete below and by whoever calls ensureProjectListLoaded/refreshProjectList.
  private readonly _projectList = signal<Project[]>([]);
  readonly projectList = this._projectList.asReadonly();
  private projectListLoaded = false;

  constructor(private http: HttpClient) {}

  ensureProjectListLoaded() {
    if (this.projectListLoaded) return;
    this.projectListLoaded = true;
    this.getProjects(1, 200, 'all', true).subscribe({
      next: (res) => this._projectList.set(res.projects),
      error: () => (this.projectListLoaded = false),
    });
  }

  refreshProjectList() {
    return this.getProjects(1, 200, 'all', true).pipe(
      tap((res) => {
        this._projectList.set(res.projects);
        this.projectListLoaded = true;
      })
    );
  }

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

  // Status breakdown + overdue count for the Projects page's stats cards —
  // `extra` is the same sort/filter query-param map buildQueryParams()
  // builds for getProjects, minus status/includeDrafts (the backend ignores
  // those for this endpoint so the cards stay tab-independent).
  getProjectStats(extra?: Record<string, string>) {
    return this.http.get<ProjectStats>(`${this.api}/stats`, { params: extra ?? {} });
  }

  // Narrow, paginated, server-searched project list for pickers (e.g. the
  // event "Tasks" tab's task-picker dialog) — `minimal=true` selects only
  // {id, name, status, department} server-side, and `includeDrafts` is
  // always on since the picker shows all four project states, not just
  // the default "exclude drafts" view. Distinct from `getProjects` above
  // (full include, used by the Projects/Drafts board pages).
  searchProjectsMinimal(page: number, limit: number, search?: string) {
    const params: Record<string, string | number> = { page, limit, minimal: 'true', includeDrafts: 'true' };
    if (search) params['search'] = search;
    return this.http.get<PaginatedProjectPickerRows>(this.api, { params });
  }

  // Top-level groups under a project, for the task-picker dialog's group
  // step — narrow `select`, no pagination (a project's group count is
  // naturally small).
  getProjectGroups(projectId: string) {
    return this.http.get<{ items: ProjectItemPickerRow[] }>(`${this.api}/${projectId}/items`, {
      params: { parentId: 'null', type: 'group' },
    });
  }

  // Tasks directly under a group, for the task-picker dialog's task step —
  // same narrow shape as getProjectGroups.
  getGroupTasks(projectId: string, groupId: number) {
    return this.http.get<{ items: ProjectItemPickerRow[] }>(`${this.api}/${projectId}/items`, {
      params: { parentId: groupId, type: 'task' },
    });
  }

  getProjectById(projectId: string) {
    return this.http.get<Project>(`${this.api}/${projectId}`);
  }

  createProject(payload: CreateProjectPayload) {
    return this.http.post<{ message: string; project: Project }>(this.api, payload).pipe(
      tap((res) => this._projectList.set([res.project, ...this._projectList()]))
    );
  }

  updateProject(projectId: string, payload: UpdateProjectPayload) {
    return this.http.put<{ message: string; project: Project }>(`${this.api}/${projectId}`, payload).pipe(
      tap((res) =>
        this._projectList.set(this._projectList().map((p) => (p.id === res.project.id ? res.project : p)))
      )
    );
  }

  deleteProject(projectId: string) {
    return this.http.delete<{ message: string }>(`${this.api}/${projectId}`).pipe(
      tap(() => this._projectList.set(this._projectList().filter((p) => p.id !== Number(projectId))))
    );
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

  // Events linked to this task/subtask — reverse side of the event "Tasks"
  // tab (see EventService.getEventTasks/linkTasks/unlinkTask). Read + unlink
  // only; linking happens from the event side's task-picker dialog.
  getItemEvents(projectId: string, itemId: number) {
    return this.http.get<{ events: LinkedEvent[] }>(`${this.api}/${projectId}/items/${itemId}/events`);
  }

  unlinkItemEvent(projectId: string, itemId: number, eventId: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${projectId}/items/${itemId}/events/${eventId}`);
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

  // Adapters for the shared <app-attachments> component (see AttachmentsAdapter) —
  // thin wiring only, the HTTP methods above are unchanged.
  attachmentsAdapterForItem(projectId: string, itemId: number): AttachmentsAdapter {
    return {
      list: () => this.getAttachments(projectId, itemId),
      upload: (file) => this.uploadAttachment(projectId, itemId, file),
      download: (a) => this.downloadAttachment(projectId, itemId, a.id),
      delete: (a) => this.deleteAttachment(projectId, itemId, a.id),
      undoDelete: (a) => this.undoDeleteAttachment(projectId, itemId, a.id),
      addLink: (payload) => this.addLinkAttachment(projectId, itemId, payload),
    };
  }

  attachmentsAdapterForProject(projectId: string): AttachmentsAdapter {
    return {
      list: () => this.getProjectAttachments(projectId),
      upload: (file) => this.uploadProjectAttachment(projectId, file),
      download: (a) => this.downloadProjectAttachment(projectId, a.id),
      delete: (a) => this.deleteProjectAttachment(projectId, a.id),
      // No undoDelete/addLink — project-level attachments are immediate-delete
      // only and have no "paste a link" endpoint.
    };
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

  // Meetings panel (Meetings tab) — Meet Hub rooms scheduled against this project.
  getMeetings(projectId: string) {
    return this.http.get<Meeting[]>(`${this.api}/${projectId}/meetings`);
  }
}
