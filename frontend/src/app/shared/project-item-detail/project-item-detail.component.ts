import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import dayjs from 'dayjs/esm';
import { ProjectService } from '../../core/services/project.service';
import { UserService } from '../../core/services/user.service';
import { AuthService } from '../../core/services/auth.service';
import {
  ProjectItem,
  ProjectItemStatus,
  ProjectItemPriority,
  ProjectTreeNode,
} from '../../models/project-item.model';
import { User } from '../../models/user.model';
import { Tag, TagLite } from '../../models/tag.model';
import { Attachment, ACCEPTED_ATTACHMENT_TYPES } from '../../models/attachment.model';
import { ProjectComment } from '../../models/comment.model';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import { TimePickerComponent } from '../time-picker/time-picker.component';
import { ModalDirective } from '../modal.directive';
import { AttachmentViewerComponent } from '../attachment-viewer/attachment-viewer.component';
import { AutoGrowDirective } from '../auto-grow.directive';
import { TagPickerComponent } from '../tag-picker/tag-picker.component';
import { HttpEventType } from '@angular/common/http';

@Component({
  selector: 'app-project-item-detail',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    FormsModule,
    DatePickerComponent,
    TimePickerComponent,
    ModalDirective,
    AttachmentViewerComponent,
    AutoGrowDirective,
    TagPickerComponent,
  ],
  templateUrl: './project-item-detail.component.html',
  styleUrl: './project-item-detail.component.css',
})
export class ProjectItemDetailComponent implements OnChanges {
  @Input() projectId = '';
  @Input() item: ProjectItem | null = null;
  @Input() childCount = 0;
  @Input() breadcrumbPath: ProjectTreeNode[] = [];
  @Input() allTags: Tag[] = [];

  @Output() closed = new EventEmitter<void>();
  // Emits the freshly-saved item (not just a signal) so the parent can patch
  // it into the tree in place instead of refetching + rebuilding everything —
  // a full reload was resetting Kanban scroll position and flashing the page
  // on every field edit.
  @Output() saved = new EventEmitter<ProjectItem>();
  @Output() breadcrumbNavigate = new EventEmitter<ProjectTreeNode>();
  @Output() tagCreated = new EventEmitter<Tag>();

  editForm: FormGroup;
  editLoading = false;
  editError = '';
  progress = 0;

  users: User[] = [];

  comments: ProjectComment[] = [];
  commentsLoading = false;
  commentBody = '';
  commentSubmitting = false;

  attachments: Attachment[] = [];
  attachmentsLoading = false;
  attachmentUploading = false;
  attachmentUploadError = '';
  downloadingId = '';
  viewerOpen = false;
  viewerIndex = 0;

  readonly statusOptions: ProjectItemStatus[] = ['todo', 'doing', 'completed'];
  readonly priorityOptions: ProjectItemPriority[] = ['low', 'medium', 'high'];
  readonly acceptedFileTypes = ACCEPTED_ATTACHMENT_TYPES;

  startDateStr: string | null = null;
  startTimeStr: string | null = null;
  endDateStr: string | null = null;
  endTimeStr: string | null = null;

  constructor(
    private fb: FormBuilder,
    private projectService: ProjectService,
    private userService: UserService,
    public auth: AuthService
  ) {
    this.editForm = this.fb.group({
      title: ['', Validators.required],
      description: [''],
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['item'] && this.item) {
      this.editForm.patchValue({ title: this.item.title, description: this.item.description });
      this.editError = '';
      this.startDateStr = this.item.startDate ? dayjs(this.item.startDate).format('YYYY-MM-DD') : null;
      this.startTimeStr = this.item.startDate ? dayjs(this.item.startDate).format('HH:mm') : null;
      this.endDateStr = this.item.endDate ? dayjs(this.item.endDate).format('YYYY-MM-DD') : null;
      this.endTimeStr = this.item.endDate ? dayjs(this.item.endDate).format('HH:mm') : null;
      this.loadComments();
      this.loadAttachments();
      if (this.users.length === 0) {
        this.userService.getAllUsers().subscribe({ next: (u) => (this.users = u) });
      }
    }
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  private brokenAvatarIds = new Set<string>();

  avatarUrl(user: User): string | null {
    const id = (user._id ?? user.id) as string;
    if (this.brokenAvatarIds.has(id)) return null;
    return this.auth.avatarUrl(user);
  }

  onAvatarError(user: User) {
    this.brokenAvatarIds.add((user._id ?? user.id) as string);
  }

  get isGroup(): boolean {
    return this.item?.type === 'group';
  }

  get canEditStatus(): boolean {
    return !this.isGroup && this.childCount === 0;
  }

  setStatus(status: ProjectItemStatus) {
    if (!this.item || !this.canEditStatus || this.item.status === status) return;
    this.projectService.updateItem(this.projectId, this.item._id, { status }).subscribe({
      next: (res) => {
        this.item = res.item;
        this.saved.emit(res.item);
      },
    });
  }

  setPriority(priority: ProjectItemPriority) {
    if (!this.item || this.item.priority === priority) return;
    this.projectService.updateItem(this.projectId, this.item._id, { priority }).subscribe({
      next: (res) => {
        this.item = res.item;
        this.saved.emit(res.item);
      },
    });
  }

  get assigneeLabel(): string {
    return this.item?.assignedTo?.username ? this.item.assignedTo.username : '-- Unassigned --';
  }

  selectAssignee(user: User | null) {
    if (!this.item || this.isGroup) return;
    const assignedTo = user ? user.id ?? user._id ?? null : null;
    this.projectService.updateItem(this.projectId, this.item._id, { assignedTo }).subscribe({
      next: (res) => {
        this.item = res.item;
        this.saved.emit(res.item);
      },
    });
  }

  selectTags(tags: TagLite[]) {
    if (!this.item) return;
    this.projectService.updateItem(this.projectId, this.item._id, { tags: tags.map((t) => t._id) }).subscribe({
      next: (res) => {
        this.item = res.item;
        this.saved.emit(res.item);
      },
    });
  }

  onTagCreated(tag: Tag) {
    this.tagCreated.emit(tag);
  }

  private combineDateTime(date: string | null, time: string | null): string | null {
    if (!date) return null;
    return dayjs(`${date} ${time || '00:00'}`, 'YYYY-MM-DD HH:mm').toISOString();
  }

  onStartDateChange(date: string | null) {
    this.startDateStr = date;
    if (!date) this.startTimeStr = null;
    this.saveDates();
  }

  onStartTimeChange(time: string | null) {
    this.startTimeStr = time;
    this.saveDates();
  }

  onEndDateChange(date: string | null) {
    this.endDateStr = date;
    if (!date) this.endTimeStr = null;
    this.saveDates();
  }

  onEndTimeChange(time: string | null) {
    this.endTimeStr = time;
    this.saveDates();
  }

  private saveDates() {
    if (!this.item) return;
    const startDate = this.combineDateTime(this.startDateStr, this.startTimeStr);
    const endDate = this.combineDateTime(this.endDateStr, this.endTimeStr);
    this.projectService.updateItem(this.projectId, this.item._id, { startDate, endDate }).subscribe({
      next: (res) => {
        this.item = res.item;
        this.saved.emit(res.item);
      },
    });
  }

  onTitleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    (event.target as HTMLElement).blur();
  }

  submitEdit() {
    if (!this.item || this.editForm.invalid) return;
    this.editLoading = true;
    this.editError = '';
    this.projectService.updateItem(this.projectId, this.item._id, this.editForm.value).subscribe({
      next: (res) => {
        this.item = res.item;
        this.editLoading = false;
        this.saved.emit(res.item);
      },
      error: (err) => {
        this.editError = err.error?.message || 'Failed to update item';
        this.editLoading = false;
      },
    });
  }

  loadComments() {
    if (!this.item) return;
    this.commentsLoading = true;
    this.projectService.getComments(this.projectId, this.item._id).subscribe({
      next: (list) => {
        this.comments = list;
        this.commentsLoading = false;
      },
      error: () => (this.commentsLoading = false),
    });
  }

  addComment() {
    const body = this.commentBody.trim();
    if (!body || !this.item) return;
    this.commentSubmitting = true;
    this.projectService.addComment(this.projectId, this.item._id, { body }).subscribe({
      next: (res) => {
        this.comments = [...this.comments, res.comment];
        this.commentBody = '';
        this.commentSubmitting = false;
      },
      error: () => (this.commentSubmitting = false),
    });
  }

  deleteComment(comment: ProjectComment) {
    if (!this.item) return;
    this.projectService.deleteComment(this.projectId, this.item._id, comment._id).subscribe({
      next: () => (this.comments = this.comments.filter((c) => c._id !== comment._id)),
    });
  }

  isOwnComment(comment: ProjectComment): boolean {
    const user = this.auth.getUser();
    if (!user) return false;
    const authorId = comment.author?._id ?? comment.author?.id;
    return authorId === user.id || authorId === user._id;
  }

  loadAttachments() {
    if (!this.item || this.isGroup) return;
    this.attachmentsLoading = true;
    this.projectService.getAttachments(this.projectId, this.item._id).subscribe({
      next: (list) => {
        this.attachments = list;
        this.attachmentsLoading = false;
      },
      error: () => (this.attachmentsLoading = false),
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.item) return;

    this.attachmentUploading = true;
    this.attachmentUploadError = '';
    this.projectService
      .uploadAttachment(this.projectId, this.item._id, file)
      .subscribe({
        next: (res) => {
          switch (res.type) {
            case HttpEventType.UploadProgress:
              if (res.total) {
                this.progress = Math.round((100 * res.loaded) / res.total);
              }
              break;
            case HttpEventType.Response:
              this.attachments = [res.body.attachment, ...this.attachments];
              this.attachmentUploading = false;
              input.value = '';
              break;
          }
        },
        error: (err) => {
          this.attachmentUploadError =
            err.error?.message || 'Failed to upload file';
          this.attachmentUploading = false;
          input.value = '';
        },
      });
  }

  download(attachment: Attachment) {
    if (!this.item) return;
    this.downloadingId = attachment._id;
    this.projectService.downloadAttachment(this.projectId, this.item._id, attachment._id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.fileName;
        link.click();
        window.URL.revokeObjectURL(url);
        this.downloadingId = '';
      },
      error: () => (this.downloadingId = ''),
    });
  }

  deleteAttachment(attachment: Attachment) {
    if (!this.item) return;
    this.projectService.deleteAttachment(this.projectId, this.item._id, attachment._id).subscribe({
      next: () => (this.attachments = this.attachments.filter((a) => a._id !== attachment._id)),
    });
  }

  loadAttachmentBlob = (attachment: Attachment) =>
    this.projectService.downloadAttachment(this.projectId, this.item!._id, attachment._id);

  openViewer(attachment: Attachment) {
    const index = this.attachments.findIndex((a) => a._id === attachment._id);
    this.viewerIndex = index >= 0 ? index : 0;
    this.viewerOpen = true;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  fileIcon(mimeType: string): string {
    if (mimeType.startsWith('image/')) return 'bi-file-earmark-image';
    if (mimeType.startsWith('video/')) return 'bi-file-earmark-play';
    if (mimeType === 'application/pdf') return 'bi-file-earmark-pdf';
    if (mimeType.includes('zip')) return 'bi-file-earmark-zip';
    if (mimeType.includes('word')) return 'bi-file-earmark-word';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'bi-file-earmark-spreadsheet';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'bi-file-earmark-slides';
    if (mimeType.startsWith('text/')) return 'bi-file-earmark-text';
    return 'bi-file-earmark';
  }
}
