import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalDirective } from '../modal.directive';
import { AppDatePipe } from '../pipes/app-date.pipe';
import { AppTimePipe } from '../pipes/app-time.pipe';
import { TaskApprovalService } from '../../core/services/task-approval.service';
import { AuthService } from '../../core/services/auth.service';
import { ProjectTreeNode } from '../../models/project-item.model';
import { User } from '../../models/user.model';
import {
  ApproverStatus,
  ApprovalProgress,
  TaskApprover,
  ApprovalComment,
  ApprovalHistoryEntry,
  ApprovalHistoryAction,
} from '../../models/task-approval.model';

type ApprovalSection = 'approvers' | 'comments' | 'history';

const HISTORY_ACTION_LABELS: Record<ApprovalHistoryAction, string> = {
  approverAssigned: 'assigned an approver',
  approverRemoved: 'removed an approver',
  approved: 'approved the task',
  changesRequested: 'requested changes',
  commentAdded: 'added a comment',
  commentEdited: 'edited a comment',
  commentDeleted: 'deleted a comment',
  reRequested: 're-requested approval',
  statusChanged: 'changed the status',
};

@Component({
  selector: 'app-task-approval-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalDirective, AppDatePipe, AppTimePipe],
  templateUrl: './task-approval-modal.component.html',
  styleUrl: './task-approval-modal.component.css',
})
export class TaskApprovalModalComponent implements OnChanges {
  @Input() open = false;
  @Input({ required: true }) projectId!: string;
  @Input() item: ProjectTreeNode | null = null;
  // Active project members — approver candidates. Same source the existing
  // single-select assignee dropdown uses (see project-tree-node.component.ts).
  @Input() members: User[] = [];
  // Gates whether the comment composer is shown at all — mirrors the
  // existing generic item-comment feature's permissiveness (any project
  // editor, not just approvers/owner/creator/admin). The server re-checks
  // via canEditProject regardless.
  @Input() canEdit = true;

  @Output() closed = new EventEmitter<void>();

  activeSection: ApprovalSection = 'approvers';

  approvers: TaskApprover[] = [];
  progress: ApprovalProgress = { approved: 0, total: 0 };
  loading = false;
  error = '';

  pickerOpen = false;
  pickerQuery = '';
  addingUserId: number | null = null;

  requestChangesOpen = false;
  requestChangesComment = '';
  requestChangesSubmitting = false;
  requestChangesError = '';

  actionLoading = false;
  actionError = '';

  comments: ApprovalComment[] = [];
  commentsLoading = false;
  commentBody = '';
  commentSubmitting = false;
  replyingTo: ApprovalComment | null = null;

  editingCommentId: number | null = null;
  editCommentBody = '';
  editCommentSubmitting = false;

  history: ApprovalHistoryEntry[] = [];
  historyLoading = false;

  constructor(
    private taskApprovalSvc: TaskApprovalService,
    public auth: AuthService
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.activeSection = 'approvers';
      this.pickerOpen = false;
      this.requestChangesOpen = false;
      this.replyingTo = null;
      this.editingCommentId = null;
      this.load();
      this.loadComments();
      this.loadHistory();
    }
  }

  setSection(section: ApprovalSection) {
    this.activeSection = section;
  }

  private load() {
    if (!this.item) return;
    this.loading = true;
    this.error = '';
    this.taskApprovalSvc.getApprovers(this.projectId, this.item.id).subscribe({
      next: ({ approvers, progress }) => {
        this.approvers = approvers;
        this.progress = progress;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load approvers';
        this.loading = false;
      },
    });
  }

  get currentUserId(): number | null {
    return this.auth.currentUser()?.id ?? null;
  }

  get myApprover(): TaskApprover | null {
    const uid = this.currentUserId;
    return this.approvers.find((a) => a.userId === uid) ?? null;
  }

  // Server is the real gate (canManageApprovers in taskApprovalController.ts,
  // which also checks canManageProjectSettings' project ownerId/createdById —
  // not available on ProjectTreeNode client-side). This only controls
  // whether the UI *offers* the controls; a 403 from the server is still
  // possible for an edge case this can't see.
  get canManage(): boolean {
    if (!this.item) return false;
    const uid = this.currentUserId;
    if (!uid) return false;
    if (uid === this.item.assignedTo?.id) return true;
    if (uid === this.item.createdBy?.id) return true;
    const role = this.auth.currentUser()?.role;
    return role === 'Admin' || role === 'Manager';
  }

  get availableMembers(): User[] {
    const activeIds = new Set(this.approvers.map((a) => a.userId));
    const q = this.pickerQuery.trim().toLowerCase();
    return this.members.filter((m) => !activeIds.has(m.id) && (!q || m.username.toLowerCase().includes(q)));
  }

  get hasChangesRequested(): boolean {
    return this.approvers.some((a) => a.status === 'changesRequested');
  }

  togglePicker() {
    this.pickerOpen = !this.pickerOpen;
    this.pickerQuery = '';
  }

  addApprover(user: User) {
    if (!this.item) return;
    this.addingUserId = user.id;
    this.actionError = '';
    this.taskApprovalSvc.assignApprovers(this.projectId, this.item.id, [user.id]).subscribe({
      next: ({ approvers }) => {
        this.approvers = approvers;
        this.recomputeProgress();
        this.addingUserId = null;
      },
      error: (err) => {
        this.actionError = err.error?.message || 'Failed to assign approver';
        this.addingUserId = null;
      },
    });
  }

  removeApprover(approver: TaskApprover) {
    if (!this.item) return;
    this.actionLoading = true;
    this.actionError = '';
    this.taskApprovalSvc.removeApprover(this.projectId, this.item.id, approver.userId).subscribe({
      next: ({ approvers }) => {
        this.approvers = approvers;
        this.recomputeProgress();
        this.actionLoading = false;
      },
      error: (err) => {
        this.actionError = err.error?.message || 'Failed to remove approver';
        this.actionLoading = false;
      },
    });
  }

  approve() {
    if (!this.item) return;
    this.actionLoading = true;
    this.actionError = '';
    this.taskApprovalSvc.approve(this.projectId, this.item.id).subscribe({
      next: ({ approvers }) => {
        this.approvers = approvers;
        this.recomputeProgress();
        this.actionLoading = false;
      },
      error: (err) => {
        this.actionError = err.error?.message || 'Failed to approve';
        this.actionLoading = false;
      },
    });
  }

  toggleRequestChanges() {
    this.requestChangesOpen = !this.requestChangesOpen;
    this.requestChangesComment = '';
    this.requestChangesError = '';
  }

  submitRequestChanges() {
    if (!this.item) return;
    const comment = this.requestChangesComment.trim();
    if (!comment) {
      this.requestChangesError = 'A comment is required to request changes.';
      return;
    }
    this.requestChangesSubmitting = true;
    this.requestChangesError = '';
    this.taskApprovalSvc.requestChanges(this.projectId, this.item.id, comment).subscribe({
      next: (res) => {
        this.approvers = res.approvers;
        this.recomputeProgress();
        this.comments = [...this.comments, res.comment];
        this.requestChangesSubmitting = false;
        this.requestChangesOpen = false;
        this.requestChangesComment = '';
      },
      error: (err) => {
        this.requestChangesError = err.error?.message || 'Failed to request changes';
        this.requestChangesSubmitting = false;
      },
    });
  }

  reRequestApproval() {
    if (!this.item) return;
    this.actionLoading = true;
    this.actionError = '';
    this.taskApprovalSvc.reRequestApproval(this.projectId, this.item.id).subscribe({
      next: ({ approvers }) => {
        this.approvers = approvers;
        this.recomputeProgress();
        this.actionLoading = false;
      },
      error: (err) => {
        this.actionError = err.error?.message || 'Failed to re-request approval';
        this.actionLoading = false;
      },
    });
  }

  private recomputeProgress() {
    this.progress = {
      approved: this.approvers.filter((a) => a.status === 'approved').length,
      total: this.approvers.length,
    };
  }

  statusLabel(status: ApproverStatus): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'approved':
        return 'Approved';
      case 'changesRequested':
        return 'Changes Requested';
      default:
        return status;
    }
  }

  // ── Discussion thread (flat across re-request cycles — no segmentation) ──

  loadComments() {
    if (!this.item) return;
    this.commentsLoading = true;
    this.taskApprovalSvc.getComments(this.projectId, this.item.id).subscribe({
      next: (list) => {
        this.comments = list;
        this.commentsLoading = false;
      },
      error: () => (this.commentsLoading = false),
    });
  }

  isOwnComment(comment: ApprovalComment): boolean {
    return comment.authorId === this.currentUserId;
  }

  // The backend stores replyToId but doesn't nest the parent object —
  // resolve it client-side from the already-loaded flat list.
  replyTarget(comment: ApprovalComment): ApprovalComment | null {
    if (!comment.replyToId) return null;
    return this.comments.find((c) => c.id === comment.replyToId) ?? null;
  }

  startReply(comment: ApprovalComment) {
    this.replyingTo = comment;
  }

  cancelReply() {
    this.replyingTo = null;
  }

  addComment() {
    const body = this.commentBody.trim();
    if (!body || !this.item) return;
    this.commentSubmitting = true;
    this.taskApprovalSvc
      .addComment(this.projectId, this.item.id, { body, replyToId: this.replyingTo?.id ?? null })
      .subscribe({
        next: (res) => {
          this.comments = [...this.comments, res.comment];
          this.commentBody = '';
          this.replyingTo = null;
          this.commentSubmitting = false;
        },
        error: () => (this.commentSubmitting = false),
      });
  }

  startEditComment(comment: ApprovalComment) {
    this.editingCommentId = comment.id;
    this.editCommentBody = comment.body;
  }

  cancelEditComment() {
    this.editingCommentId = null;
    this.editCommentBody = '';
  }

  submitEditComment() {
    const body = this.editCommentBody.trim();
    if (!body || !this.item || this.editingCommentId == null) return;
    this.editCommentSubmitting = true;
    this.taskApprovalSvc.updateComment(this.projectId, this.item.id, this.editingCommentId, { body }).subscribe({
      next: (res) => {
        this.comments = this.comments.map((c) => (c.id === res.comment.id ? res.comment : c));
        this.editCommentSubmitting = false;
        this.cancelEditComment();
      },
      error: () => (this.editCommentSubmitting = false),
    });
  }

  deleteComment(comment: ApprovalComment) {
    if (!this.item) return;
    this.taskApprovalSvc.deleteComment(this.projectId, this.item.id, comment.id).subscribe({
      next: () => (this.comments = this.comments.filter((c) => c.id !== comment.id)),
    });
  }

  // ── Approval history ──

  loadHistory() {
    if (!this.item) return;
    this.historyLoading = true;
    this.taskApprovalSvc.getHistory(this.projectId, this.item.id).subscribe({
      next: (list) => {
        this.history = list;
        this.historyLoading = false;
      },
      error: () => (this.historyLoading = false),
    });
  }

  historyLabel(entry: ApprovalHistoryEntry): string {
    return HISTORY_ACTION_LABELS[entry.action] ?? entry.action;
  }
}
