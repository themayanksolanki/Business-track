import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
  TaskApprover,
  ApproversResponse,
  ApprovalHistoryEntry,
  ApprovalComment,
  CreateApprovalCommentPayload,
  UpdateApprovalCommentPayload,
} from '../../models/task-approval.model';

@Injectable({ providedIn: 'root' })
export class TaskApprovalService {
  private readonly api = `${environment.apiUrl}/projects`;

  constructor(private http: HttpClient) {}

  getApprovers(projectId: string, itemId: number) {
    return this.http.get<ApproversResponse>(`${this.api}/${projectId}/items/${itemId}/approvers`);
  }

  assignApprovers(projectId: string, itemId: number, userIds: number[]) {
    return this.http.post<{ message: string; approvers: TaskApprover[] }>(
      `${this.api}/${projectId}/items/${itemId}/approvers`,
      { userIds }
    );
  }

  removeApprover(projectId: string, itemId: number, userId: number) {
    return this.http.delete<{ message: string; approvers: TaskApprover[] }>(
      `${this.api}/${projectId}/items/${itemId}/approvers/${userId}`
    );
  }

  approve(projectId: string, itemId: number) {
    return this.http.post<{ message: string; approvers: TaskApprover[] }>(
      `${this.api}/${projectId}/items/${itemId}/approve`,
      {}
    );
  }

  requestChanges(projectId: string, itemId: number, comment: string) {
    return this.http.post<{ message: string; approvers: TaskApprover[]; comment: ApprovalComment }>(
      `${this.api}/${projectId}/items/${itemId}/request-changes`,
      { comment }
    );
  }

  reRequestApproval(projectId: string, itemId: number) {
    return this.http.post<{ message: string; approvers: TaskApprover[] }>(
      `${this.api}/${projectId}/items/${itemId}/re-request`,
      {}
    );
  }

  getHistory(projectId: string, itemId: number) {
    return this.http.get<ApprovalHistoryEntry[]>(`${this.api}/${projectId}/items/${itemId}/approval-history`);
  }

  getComments(projectId: string, itemId: number) {
    return this.http.get<ApprovalComment[]>(`${this.api}/${projectId}/items/${itemId}/approval-comments`);
  }

  addComment(projectId: string, itemId: number, payload: CreateApprovalCommentPayload) {
    return this.http.post<{ message: string; comment: ApprovalComment }>(
      `${this.api}/${projectId}/items/${itemId}/approval-comments`,
      payload
    );
  }

  updateComment(projectId: string, itemId: number, commentId: number, payload: UpdateApprovalCommentPayload) {
    return this.http.patch<{ message: string; comment: ApprovalComment }>(
      `${this.api}/${projectId}/items/${itemId}/approval-comments/${commentId}`,
      payload
    );
  }

  deleteComment(projectId: string, itemId: number, commentId: number) {
    return this.http.delete<{ message: string }>(
      `${this.api}/${projectId}/items/${itemId}/approval-comments/${commentId}`
    );
  }
}
