import { Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../core/services/task.service';
import { UserService } from '../../core/services/user.service';
import { AuthService } from '../../core/services/auth.service';
import { AttachmentService } from '../../core/services/attachment.service';
import { Task, TaskStatus } from '../../models/task.model';
import { User } from '../../models/user.model';
import { Attachment } from '../../models/attachment.model';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, FormsModule, ConfirmDialogComponent],
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
  }

  private readonly statusRank: Record<string, number> = { todo: 0, pending: 1, completed: 2 };

  get sortedTasks(): Task[] {
    if (!this.statusSortDir) return this.tasks;
    return [...this.tasks].sort((a, b) => {
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

  reassignTaskId = '';
  reassignUserId = '';

  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  confirmLoading = false;
  private pendingDelete: { id: string; parentId?: string } | null = null;

  selectedTask: Task | null = null;
  subtasks: Task[] = [];
  subtaskTitle = '';
  subtaskLoading = false;
  subtaskError = '';

  editTaskId = '';
  editForm: FormGroup;
  editLoading = false;
  editError = '';

  createOpen = false;
  createForm: FormGroup;
  createLoading = false;
  createError = '';
  createAssignees: User[] = [];

  attachmentTaskId = '';
  attachmentTask: Task | null = null;
  attachments: Attachment[] = [];
  attachmentsLoading = false;
  attachmentsError = '';
  attachmentUploading = false;
  attachmentUploadError = '';
  downloadingId = '';

  constructor(
    private fb: FormBuilder,
    private taskService: TaskService,
    private userService: UserService,
    private attachmentService: AttachmentService,
    public auth: AuthService
  ) {
    this.editForm = this.fb.group({
      title: ['', Validators.required],
      description: [''],
      status: ['todo'],
    });
    this.createForm = this.fb.group({
      title: ['', Validators.required],
      description: [''],
      assignedTo: [''],
    });
  }

  ngOnInit() {
    this.load();
    if (this.isManager) {
      this.userService.getAllUsers().subscribe({
        next: (u) => { this.users = u; this.createAssignees = u; },
      });
    } else if (this.isTeamLead) {
      this.userService.getTeamMembers().subscribe({ next: (u) => (this.createAssignees = u) });
    }
  }

  load() {
    this.taskService.getTasks().subscribe({
      next: (tasks) => {
        this.tasks = tasks;
        if (this.currentPage > this.totalPages) this.currentPage = 1;
      },
      error: (err) => (this.error = err.error?.message || 'Failed to load tasks'),
    });
  }

  delete(task: Task) {
    this.pendingDelete = { id: task._id };
    this.confirmTitle = 'Delete Task';
    this.confirmMessage = `"${task.title}" and all its subtasks will be permanently deleted.`;
    this.confirmOpen = true;
  }

  deleteSubtask(subId: string, parentId: string) {
    const sub = this.subtasks.find((s) => s._id === subId);
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
          this.load();
        }
      },
      error: () => {
        this.confirmLoading = false;
        this.confirmOpen = false;
        this.pendingDelete = null;
      },
    });
  }

  cancelConfirm() {
    this.confirmOpen = false;
    this.pendingDelete = null;
  }

  openEdit(task: Task) {
    this.editTaskId = task._id;
    this.editError = '';
    this.editForm.patchValue({
      title: task.title,
      description: task.description,
      status: task.status,
    });
    this.selectedTask = null;
    this.subtasks = [];
    this.subtaskTitle = '';
  }

  closeEdit() {
    this.editTaskId = '';
    this.editError = '';
  }

  get editStatusLabel(): string {
    const labels: Record<string, string> = { todo: 'Todo', pending: 'Pending', completed: 'Completed' };
    return labels[this.editForm.get('status')?.value] ?? 'Todo';
  }

  selectEditStatus(status: string) {
    this.editForm.get('status')?.setValue(status);
  }

  submitEdit() {
    if (this.editForm.invalid) return;
    this.editLoading = true;
    this.editError = '';
    this.taskService.updateTask(this.editTaskId, this.editForm.value).subscribe({
      next: () => {
        this.editLoading = false;
        this.closeEdit();
        this.load();
      },
      error: (err) => {
        this.editError = err.error?.message || 'Failed to update task';
        this.editLoading = false;
      },
    });
  }

  openReassign(taskId: string) {
    this.reassignTaskId = taskId;
    this.reassignUserId = '';
  }

  get reassignUserLabel() {
    if (!this.reassignUserId) return '-- Select User --';
    const u = this.users.find((u) => (u.id ?? u._id) === this.reassignUserId);
    return u ? `${u.username} (${u.role})` : '-- Select User --';
  }

  selectReassignUser(user: User) {
    this.reassignUserId = user.id ?? user._id ?? '';
  }

  confirmReassign() {
    if (!this.reassignUserId) return;
    this.taskService.reassignTask(this.reassignTaskId, this.reassignUserId).subscribe({
      next: () => {
        this.reassignTaskId = '';
        this.load();
      },
    });
  }

  openDetail(task: Task) {
    this.selectedTask = task;
    this.subtasks = [];
    this.subtaskTitle = '';
    this.subtaskError = '';
    this.loadSubtasks(task._id);
  }

  closeDetail() {
    this.selectedTask = null;
    this.subtasks = [];
    this.subtaskTitle = '';
    this.subtaskError = '';
  }

  loadSubtasks(taskId: string) {
    this.taskService.getSubtasks(taskId).subscribe({
      next: (subs) => (this.subtasks = subs),
    });
  }

  addSubtask(parent: Task) {
    const title = this.subtaskTitle.trim();
    if (!title) return;
    this.subtaskLoading = true;
    this.subtaskError = '';
    const assignedToId = (parent.assignedTo as User)._id ?? (parent.assignedTo as User).id;
    this.taskService.createTask({ title, parentTask: parent._id, assignedTo: assignedToId }).subscribe({
      next: () => {
        this.subtaskLoading = false;
        this.subtaskTitle = '';
        this.loadSubtasks(parent._id);
      },
      error: (err) => {
        this.subtaskError = err.error?.message || 'Failed to add subtask';
        this.subtaskLoading = false;
      },
    });
  }


  setStatus(task: Task, status: TaskStatus) {
    if (task.status === status) return;
    this.taskService.updateTask(task._id, { status }).subscribe({
      next: () => {
        task.status = status;
        if (this.selectedTask?._id === task._id) {
          this.selectedTask = { ...task, status };
        }
      },
    });
  }

  private readonly roleRank: Record<string, number> = { Manager: 3, 'Team Lead': 2, Employee: 1 };

  canDelete(task: Task): boolean {
    const user = this.auth.getUser();
    if (!user) return false;
    const creatorId = task.createdBy?._id ?? (task.createdBy as any)?.id;
    const isCreator = creatorId === user.id || creatorId === user._id;
    const callerRank = this.roleRank[user.role] ?? 0;
    const creatorRank = this.roleRank[task.createdBy?.role] ?? 0;
    return isCreator || callerRank > creatorRank;
  }

  get isManager() { return this.auth.getUser()?.role === 'Manager'; }
  get isTeamLead() { return this.auth.getUser()?.role === 'Team Lead'; }
  get isEmployee() { return this.auth.getUser()?.role === 'Employee'; }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  get createAssignee(): User | null {
    const id = this.createForm.get('assignedTo')?.value;
    if (!id) return null;
    return this.createAssignees.find((u) => (u.id ?? u._id) === id) ?? null;
  }

  get reassignUser(): User | null {
    if (!this.reassignUserId) return null;
    return this.users.find((u) => (u.id ?? u._id) === this.reassignUserId) ?? null;
  }

  openCreate() {
    this.createForm.reset({ title: '', description: '', assignedTo: '' });
    this.createError = '';
    this.createOpen = true;
  }

  closeCreate() {
    this.createOpen = false;
    this.createError = '';
  }

  get createAssigneeLabel(): string {
    const id = this.createForm.get('assignedTo')?.value;
    if (!id) return '-- Assign to self --';
    const u = this.createAssignees.find((u) => (u.id ?? u._id) === id);
    return u ? `${u.username} (${u.role})` : '-- Assign to self --';
  }

  selectCreateAssignee(user: User | null) {
    this.createForm.get('assignedTo')?.setValue(user ? (user.id ?? user._id ?? '') : '');
  }

  submitCreate() {
    if (this.createForm.invalid) return;
    this.createLoading = true;
    this.createError = '';
    const payload = { ...this.createForm.value };
    if (!payload.assignedTo) delete payload.assignedTo;
    this.taskService.createTask(payload).subscribe({
      next: () => {
        this.createLoading = false;
        this.closeCreate();
        this.load();
      },
      error: (err) => {
        this.createError = err.error?.message || 'Failed to create task';
        this.createLoading = false;
      },
    });
  }

  openAttachments(task: Task) {
    this.attachmentTaskId = task._id;
    this.attachmentTask = task;
    this.attachments = [];
    this.attachmentsError = '';
    this.attachmentUploadError = '';
    this.loadAttachments(task._id);
  }

  closeAttachments() {
    this.attachmentTaskId = '';
    this.attachmentTask = null;
    this.attachments = [];
  }

  loadAttachments(taskId: string) {
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

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.attachmentTaskId) return;

    this.attachmentUploading = true;
    this.attachmentUploadError = '';
    this.attachmentService.uploadAttachment(this.attachmentTaskId, file).subscribe({
      next: (res) => {
        this.attachments = [res.attachment, ...this.attachments];
        this.attachmentUploading = false;
        input.value = '';
      },
      error: (err) => {
        this.attachmentUploadError = err.error?.message || 'Failed to upload file';
        this.attachmentUploading = false;
        input.value = '';
      },
    });
  }

  download(attachment: Attachment) {
    if (!this.attachmentTaskId) return;
    this.downloadingId = attachment._id;
    this.attachmentService.downloadAttachment(this.attachmentTaskId, attachment._id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.fileName;
        link.click();
        window.URL.revokeObjectURL(url);
        this.downloadingId = '';
      },
      error: () => {
        this.downloadingId = '';
      },
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  fileIcon(mimeType: string): string {
    if (mimeType.startsWith('image/')) return 'bi-file-earmark-image';
    if (mimeType === 'application/pdf') return 'bi-file-earmark-pdf';
    if (mimeType.includes('zip')) return 'bi-file-earmark-zip';
    if (mimeType.includes('word')) return 'bi-file-earmark-word';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'bi-file-earmark-spreadsheet';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'bi-file-earmark-slides';
    if (mimeType.startsWith('text/')) return 'bi-file-earmark-text';
    return 'bi-file-earmark';
  }
}
