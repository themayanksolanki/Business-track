import { Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TaskService } from '../../core/services/task.service';
import { UserService } from '../../core/services/user.service';
import { AuthService } from '../../core/services/auth.service';
import { AttachmentService } from '../../core/services/attachment.service';
import { Task, TaskStatus, CreateTaskPayload, UpdateTaskPayload } from '../../models/task.model';
import { User } from '../../models/user.model';
import { Tag } from '../../models/tag.model';
import { Attachment } from '../../models/attachment.model';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { NotificationService } from '../../shared/notification.service';
import { AttachmentViewerComponent } from '../../shared/attachment-viewer/attachment-viewer.component';
import { TaskFormModalComponent } from '../../shared/task-form-modal/task-form-modal.component';
import { TaskDetailModalComponent } from '../../shared/task-detail-modal/task-detail-modal.component';
import { TaskEditModalComponent, TaskEditInitial } from '../../shared/task-edit-modal/task-edit-modal.component';
import { TaskAttachmentsModalComponent } from '../../shared/task-attachments-modal/task-attachments-modal.component';
import { TagService } from '../../core/services/tag.service';
import { TagPillComponent } from '../../shared/tag-pill/tag-pill.component';
import { HelpTipComponent } from '../../shared/help-tip/help-tip.component';

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [
    DatePipe,
    ConfirmDialogComponent,
    AttachmentViewerComponent,
    TaskFormModalComponent,
    TaskDetailModalComponent,
    TaskEditModalComponent,
    TaskAttachmentsModalComponent,
    TagPillComponent,
    HelpTipComponent,
  ],
  templateUrl: './task-list.component.html',
  styleUrl: './task-list.component.css',
})
export class TaskListComponent implements OnInit {
  tasks: Task[] = [];
  users: User[] = [];
  error = '';

  currentPage = 1;
  readonly pageSize = 8;
  statusSortDir: 'asc' | 'desc' | null = null;

  toggleStatusSort() {
    if (this.statusSortDir === null || this.statusSortDir === 'desc') {
      this.statusSortDir = 'asc';
    } else {
      this.statusSortDir = 'desc';
    }
    this.currentPage = 1;
    this.recomputeSortedTasks();
  }

  private readonly statusRank: Record<string, number> = { todo: 0, pending: 1, completed: 2 };

  // Cached, not a getter: re-sorting the full list is O(n log n) and this is
  // read from the template every change-detection cycle. Recomputed only at
  // the specific mutation points below (load/create/delete/edit/sort-toggle).
  sortedTasks: Task[] = [];

  private recomputeSortedTasks() {
    if (!this.statusSortDir) {
      this.sortedTasks = this.tasks;
      return;
    }
    this.sortedTasks = [...this.tasks].sort((a, b) => {
      const cmp = (this.statusRank[a.status] ?? 0) - (this.statusRank[b.status] ?? 0);
      return this.statusSortDir === 'asc' ? cmp : -cmp;
    });
  }

  get paginatedTasks(): Task[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.sortedTasks.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    return Math.ceil(this.tasks.length / this.pageSize);
  }

  get pageEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.tasks.length);
  }

  get pageNumbers(): number[] {
    const total = this.totalPages;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages: number[] = [1];
    const left = Math.max(2, this.currentPage - 1);
    const right = Math.min(total - 1, this.currentPage + 1);

    if (left > 2) pages.push(-1);
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < total - 1) pages.push(-1);
    pages.push(total);
    return pages;
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  confirmLoading = false;
  private pendingDelete: { id: number; parentId?: number } | null = null;

  selectedTask: Task | null = null;
  subtasks: Task[] = [];
  subtaskLoading = false;
  subtaskError = '';

  editTask: Task | null = null;
  editLoading = false;
  editError = '';

  createOpen = false;
  createLoading = false;
  createError = '';
  createAssignees: User[] = [];

  allTags: Tag[] = [];

  attachmentTaskId: number | null = null;
  attachmentTask: Task | null = null;
  attachments: Attachment[] = [];
  attachmentsLoading = false;
  attachmentsError = '';
  attachmentUploading = false;
  attachmentUploadError = '';
  downloadingId: number | null = null;
  viewerOpen = false;
  viewerIndex = 0;

  constructor(
    private taskService: TaskService,
    private userService: UserService,
    private attachmentService: AttachmentService,
    private tagService: TagService,
    private notifications: NotificationService,
    public auth: AuthService
  ) {}

  ngOnInit() {
    this.load();
    if (this.isAdmin || this.isManager) {
      this.userService.getAllUsers().subscribe({
        next: (u) => { this.users = u; this.createAssignees = u; },
      });
    } else if (this.isTeamLead) {
      this.userService.getTeamMembers().subscribe({ next: (u) => (this.createAssignees = u) });
    }
    this.tagService.getTags().subscribe({ next: (t) => (this.allTags = t) });
  }

  onTagCreated(tag: Tag) {
    this.allTags = [...this.allTags, tag];
  }

  load() {
    this.taskService.getTasks().subscribe({
      next: (tasks) => {
        this.tasks = tasks;
        this.recomputeSortedTasks();
        if (this.currentPage > this.totalPages) this.currentPage = 1;
      },
      error: (err) => (this.error = err.error?.message || 'Failed to load tasks'),
    });
  }

  delete(task: Task) {
    this.pendingDelete = { id: task.id };
    this.confirmTitle = 'Delete Task';
    this.confirmMessage = `"${task.title}" and all its subtasks will be permanently deleted.`;
    this.confirmOpen = true;
  }

  deleteSubtask(subId: number) {
    if (!this.selectedTask) return;
    const parentId = this.selectedTask.id;
    const sub = this.subtasks.find((s) => s.id === subId);
    this.pendingDelete = { id: subId, parentId };
    this.confirmTitle = 'Delete Subtask';
    this.confirmMessage = sub ? `"${sub.title}" will be permanently deleted.` : 'This subtask will be permanently deleted.';
    this.confirmOpen = true;
  }

  confirmDelete() {
    if (!this.pendingDelete) return;
    this.confirmLoading = true;
    const { id, parentId } = this.pendingDelete;
    this.taskService.deleteTask(id).subscribe({
      next: () => {
        this.confirmLoading = false;
        this.confirmOpen = false;
        this.pendingDelete = null;
        if (parentId) {
          this.loadSubtasks(parentId);
        } else {
          this.selectedTask = null;
          this.tasks = this.tasks.filter((t) => t.id !== id);
          this.recomputeSortedTasks();
          if (this.currentPage > this.totalPages) this.currentPage = Math.max(1, this.totalPages);
        }
        this.notifications.success('Task deleted');
      },
      error: (err) => {
        this.confirmLoading = false;
        this.confirmOpen = false;
        this.pendingDelete = null;
        this.notifications.error(err.error?.message || 'Failed to delete task');
      },
    });
  }

  cancelConfirm() {
    this.confirmOpen = false;
    this.pendingDelete = null;
  }

  openEdit(task: Task) {
    this.editTask = task;
    this.editError = '';
    this.selectedTask = null;
    this.subtasks = [];
  }

  closeEdit() {
    this.editTask = null;
    this.editError = '';
  }

  get editInitial(): TaskEditInitial | null {
    if (!this.editTask) return null;
    return {
      title: this.editTask.title,
      description: this.editTask.description,
      status: this.editTask.status,
      tags: this.editTask.tags,
    };
  }

  submitEdit(payload: UpdateTaskPayload) {
    if (!this.editTask) return;
    const taskId = this.editTask.id;
    this.editLoading = true;
    this.editError = '';
    this.taskService.updateTask(taskId, payload).subscribe({
      next: (res) => {
        this.editLoading = false;
        const existing = this.tasks.find((t) => t.id === taskId);
        if (existing) Object.assign(existing, res.task);
        this.recomputeSortedTasks();
        this.closeEdit();
        this.notifications.success('Task updated');
      },
      error: (err) => {
        this.editError = err.error?.message || 'Failed to update task';
        this.editLoading = false;
      },
    });
  }

  reassign(task: Task, user: User) {
    if (task.assignedTo.id === user.id) return;
    this.taskService.reassignTask(task.id, user.id).subscribe({
      next: (res) => {
        const existing = this.tasks.find((t) => t.id === task.id);
        if (existing) Object.assign(existing, res.task);
        this.notifications.success('Task reassigned');
      },
      error: (err) => {
        this.notifications.error(err.error?.message || 'Failed to reassign task');
      },
    });
  }

  openDetail(task: Task) {
    this.selectedTask = task;
    this.subtasks = [];
    this.subtaskError = '';
    this.loadSubtasks(task.id);
  }

  closeDetail() {
    this.selectedTask = null;
    this.subtasks = [];
    this.subtaskError = '';
  }

  loadSubtasks(taskId: number) {
    this.taskService.getSubtasks(taskId).subscribe({
      next: (subs) => (this.subtasks = subs),
    });
  }

  addSubtask(title: string) {
    const parent = this.selectedTask;
    if (!parent) return;
    this.subtaskLoading = true;
    this.subtaskError = '';
    const assignedToId = (parent.assignedTo as User).id;
    this.taskService.createTask({ title, parentTask: parent.id, assignedTo: assignedToId }).subscribe({
      next: () => {
        this.subtaskLoading = false;
        this.loadSubtasks(parent.id);
      },
      error: (err) => {
        this.subtaskError = err.error?.message || 'Failed to add subtask';
        this.subtaskLoading = false;
      },
    });
  }

  setStatus(task: Task, status: TaskStatus) {
    if (task.status === status) return;
    this.taskService.updateTask(task.id, { status }).subscribe({
      next: () => {
        task.status = status;
        if (this.selectedTask?.id === task.id) {
          this.selectedTask = { ...task, status };
        }
        this.recomputeSortedTasks();
        this.notifications.success('Status updated');
      },
      error: (err) => {
        this.notifications.error(err.error?.message || 'Failed to update status');
      },
    });
  }

  private readonly roleRank: Record<string, number> = { Admin: 4, Manager: 3, 'Team Lead': 2, User: 1 };

  canDelete(task: Task): boolean {
    const user = this.auth.getUser();
    if (!user) return false;
    const creatorId = task.createdBy?.id;
    const isCreator = creatorId === user.id;
    const callerRank = this.roleRank[user.role] ?? 0;
    const creatorRank = this.roleRank[task.createdBy?.role] ?? 0;
    return isCreator || callerRank > creatorRank;
  }

  get isAdmin() { return this.auth.getUser()?.role === 'Admin'; }
  get isManager() { return this.auth.getUser()?.role === 'Manager'; }
  get isTeamLead() { return this.auth.getUser()?.role === 'Team Lead'; }
  get isUser() { return this.auth.getUser()?.role === 'User'; }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  private brokenAvatarIds = new Set<number>();

  avatarUrl(user: User): string | null {
    if (this.brokenAvatarIds.has(user.id)) return null;
    return this.auth.avatarUrl(user);
  }

  onAvatarError(user: User) {
    this.brokenAvatarIds.add(user.id);
  }

  openCreate() {
    this.createError = '';
    this.createOpen = true;
  }

  closeCreate() {
    this.createOpen = false;
    this.createError = '';
  }

  submitCreate(payload: CreateTaskPayload) {
    this.createLoading = true;
    this.createError = '';
    this.taskService.createTask(payload).subscribe({
      next: (res) => {
        this.createLoading = false;
        this.tasks = [res.task, ...this.tasks];
        this.recomputeSortedTasks();
        this.closeCreate();
        this.notifications.success('Task created');
      },
      error: (err) => {
        this.createError = err.error?.message || 'Failed to create task';
        this.createLoading = false;
      },
    });
  }

  openAttachments(task: Task) {
    this.attachmentTaskId = task.id;
    this.attachmentTask = task;
    this.attachments = [];
    this.attachmentsError = '';
    this.attachmentUploadError = '';
    this.loadAttachments(task.id);
  }

  closeAttachments() {
    this.attachmentTaskId = null;
    this.attachmentTask = null;
    this.attachments = [];
  }

  loadAttachments(taskId: number) {
    this.attachmentsLoading = true;
    this.attachmentsError = '';
    this.attachmentService.getAttachments(taskId).subscribe({
      next: (list) => {
        this.attachments = list;
        this.attachmentsLoading = false;
      },
      error: (err) => {
        this.attachmentsError = err.error?.message || 'Failed to load attachments';
        this.attachmentsLoading = false;
      },
    });
  }

  onFileSelected(file: File) {
    if (!this.attachmentTaskId) return;

    this.attachmentUploading = true;
    this.attachmentUploadError = '';
    this.attachmentService.uploadAttachment(this.attachmentTaskId, file).subscribe({
      next: (res) => {
        this.attachments = [res.attachment, ...this.attachments];
        this.attachmentUploading = false;
      },
      error: (err) => {
        this.attachmentUploadError = err.error?.message || 'Failed to upload file';
        this.attachmentUploading = false;
      },
    });
  }

  download(attachment: Attachment) {
    if (!this.attachmentTaskId) return;
    this.downloadingId = attachment.id;
    this.attachmentService.downloadAttachment(this.attachmentTaskId, attachment.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.fileName;
        link.click();
        window.URL.revokeObjectURL(url);
        this.downloadingId = null;
      },
      error: () => {
        this.downloadingId = null;
      },
    });
  }

  loadAttachmentBlob = (attachment: Attachment) =>
    this.attachmentService.downloadAttachment(this.attachmentTaskId!, attachment.id);

  openViewer(attachment: Attachment) {
    const index = this.attachments.findIndex((a) => a.id === attachment.id);
    this.viewerIndex = index >= 0 ? index : 0;
    this.viewerOpen = true;
  }
}
