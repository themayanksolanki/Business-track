import { Component, Input, Output, EventEmitter, OnChanges, OnInit, OnDestroy, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MentionModule } from 'angular-mentions';
import dayjs from 'dayjs/esm';
import { ProjectService } from '../../core/services/project.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../notification.service';
import {
  ProjectItem,
  ProjectItemStatus,
  ProjectItemPriority,
  ProjectTreeNode,
} from '../../models/project-item.model';
import { User } from '../../models/user.model';
import { Tag, TagLite } from '../../models/tag.model';
import { Attachment, ACCEPTED_ATTACHMENT_TYPES } from '../../models/attachment.model';
import { ProjectComment, CommentMention } from '../../models/comment.model';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import { TimePickerComponent } from '../time-picker/time-picker.component';
import { ModalDirective } from '../modal.directive';
import { AttachmentViewerComponent } from '../attachment-viewer/attachment-viewer.component';
import { AutoGrowDirective } from '../auto-grow.directive';
import { TagPickerComponent } from '../tag-picker/tag-picker.component';
import { TagPillComponent } from '../tag-pill/tag-pill.component';
import { HttpEventType } from '@angular/common/http';
import { AppDatePipe } from '../pipes/app-date.pipe';
import { AppTimePipe } from '../pipes/app-time.pipe';

@Component({
  selector: 'app-project-item-detail',
  standalone: true,
  imports: [
    AppDatePipe,
    AppTimePipe,
    ReactiveFormsModule,
    FormsModule,
    DatePickerComponent,
    TimePickerComponent,
    ModalDirective,
    AttachmentViewerComponent,
    AutoGrowDirective,
    TagPickerComponent,
    TagPillComponent,
    MentionModule,
  ],
  templateUrl: './project-item-detail.component.html',
  styleUrl: './project-item-detail.component.css',
})
export class ProjectItemDetailComponent implements OnChanges, OnInit, OnDestroy {
  @Input() projectId = '';
  @Input() item: ProjectItem | null = null;
  @Input() childCount = 0;
  @Input() breadcrumbPath: ProjectTreeNode[] = [];
  @Input() allTags: Tag[] = [];
  // Scoped to project members only (passed down from the parent's
  // project.members), not the full org user list.
  @Input() users: User[] = [];
  // True while the parent project is a draft — locks status (stays 'todo')
  // and dates (visible, cursor: not-allowed) until it's approved. Everything
  // else (priority, assignee, tags, description, attachments) stays editable.
  @Input() readOnly = false;
  // Role-based permission (Admin/creator/owner/editor-role member = true, a
  // member with a view-only role = false) — distinct from the draft-lock
  // `readOnly` above; this hides every edit affordance entirely rather than
  // disabling it.
  @Input() canEdit = true;
  // True only for a "Copy Project Link" visitor without real project access
  // (see ProjectDetailComponent.loadSharedProject) — comments/attachments
  // have no shared-link read equivalent yet, so those sections are skipped
  // entirely here rather than firing requests that would just 403.
  @Input() sharedViewOnly = false;
  // Deep-link from a notification: once comments load, scroll to and
  // highlight the comment with this id.
  @Input() highlightCommentId: number | null = null;

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

  comments: ProjectComment[] = [];
  commentsLoading = false;
  commentBody = '';
  commentSubmitting = false;

  editingCommentId: number | null = null;
  editCommentBody = '';
  editCommentSubmitting = false;

  // Tracks @mentions actually selected from the dropdown during the current
  // compose/edit session (fed by angular-mentions' (itemSelected) event) —
  // this is what lets mentions be identified by user id rather than by
  // parsing the text. At submit time each is kept only if its "@username"
  // text is still present, so deleting a mention before saving drops it.
  private descriptionMentions: CommentMention[] = [];
  private commentMentions: CommentMention[] = [];
  private editCommentMentions: CommentMention[] = [];

  readonly mentionConfig = {
    triggerChar: '@',
    labelKey: 'username',
    mentionSelect: (u: User) => '@' + u.username + ' ',
    mentionFilter: (search: string, items: User[]) => {
      const term = search.toLowerCase();
      return items.filter(
        (u) => u.username.toLowerCase().includes(term) || (u.email && u.email.toLowerCase().includes(term))
      );
    },
  };

  attachments: Attachment[] = [];
  attachmentsLoading = false;
  attachmentUploading = false;
  attachmentUploadError = '';
  downloadingId: number | null = null;
  viewerOpen = false;
  viewerIndex = 0;

  addLinkOpen = false;
  linkUrlInput = '';
  linkLabelInput = '';
  addLinkLoading = false;
  addLinkError = '';

  readonly statusOptions: ProjectItemStatus[] = ['todo', 'doing', 'completed'];
  readonly priorityOptions: ProjectItemPriority[] = ['low', 'medium', 'high'];
  readonly acceptedFileTypes = ACCEPTED_ATTACHMENT_TYPES;

  // Presentation-only clock the countdown badges read from — the actual
  // deletion is driven server-side off pendingDeleteAt, this just ticks the
  // displayed "Xs" down each second.
  private now = Date.now();
  private tickHandle?: ReturnType<typeof setInterval>;
  private pollHandle?: ReturnType<typeof setInterval>;
  // Matches the backend's countdown (see PENDING_DELETE_MS in
  // attachmentController.js) — frequent enough that the list catches up
  // shortly after the badge hits 0, without polling constantly.
  private readonly ATTACHMENTS_POLL_MS = 2000;

  startDateStr: string | null = null;
  startTimeStr: string | null = null;
  endDateStr: string | null = null;
  endTimeStr: string | null = null;

  constructor(
    private fb: FormBuilder,
    private projectService: ProjectService,
    public auth: AuthService,
    private sanitizer: DomSanitizer,
    private notifications: NotificationService
  ) {
    this.editForm = this.fb.group({
      title: ['', Validators.required],
      description: [''],
    });
  }

  ngOnInit() {
    this.tickHandle = setInterval(() => (this.now = Date.now()), 1000);
  }

  ngOnDestroy() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.stopAttachmentsPolling();
  }

  isPending(a: Attachment): boolean {
    return !!a.pendingDeleteAt && new Date(a.pendingDeleteAt).getTime() > this.now;
  }

  remainingSeconds(a: Attachment): number {
    if (!a.pendingDeleteAt) return 0;
    return Math.max(0, Math.ceil((new Date(a.pendingDeleteAt).getTime() - this.now) / 1000));
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['item'] && this.item) {
      this.editForm.patchValue({ title: this.item.title, description: this.item.description });
      this.editError = '';
      this.startDateStr = this.item.startDate ? dayjs(this.item.startDate).format('YYYY-MM-DD') : null;
      this.startTimeStr = this.item.startDate ? dayjs(this.item.startDate).format('HH:mm') : null;
      this.endDateStr = this.item.endDate ? dayjs(this.item.endDate).format('YYYY-MM-DD') : null;
      this.endTimeStr = this.item.endDate ? dayjs(this.item.endDate).format('HH:mm') : null;
      // A fresh item means a fresh compose session — stale mention
      // selections from whatever was previously open shouldn't leak in.
      this.descriptionMentions = [];
      this.commentMentions = [];
      this.editingCommentId = null;
      if (!this.sharedViewOnly) {
        this.loadComments();
        this.loadAttachments();
      }
    }
  }

  private addPendingMention(list: CommentMention[], user: User) {
    if (!list.some((m) => m.userId === user.id)) list.push({ userId: user.id, username: user.username });
  }

  onDescriptionMentionSelected(user: User) {
    this.addPendingMention(this.descriptionMentions, user);
  }

  onCommentMentionSelected(user: User) {
    this.addPendingMention(this.commentMentions, user);
  }

  onEditCommentMentionSelected(user: User) {
    this.addPendingMention(this.editCommentMentions, user);
  }

  // A tracked selection only counts if its "@username" text is still present
  // in the final text — this is what makes deleting a mention before saving
  // correctly drop it (no notification for a mention that was removed).
  private finalizeMentions(text: string, pending: CommentMention[]): CommentMention[] {
    return pending.filter((m) => text.includes('@' + m.username));
  }

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

  get isGroup(): boolean {
    return this.item?.type === 'group';
  }

  get canEditStatus(): boolean {
    return !this.isGroup && this.childCount === 0 && !this.readOnly && this.canEdit;
  }

  setStatus(status: ProjectItemStatus) {
    if (!this.item || !this.canEditStatus || this.item.status === status) return;
    this.projectService.updateItem(this.projectId, this.item.id, { status }).subscribe({
      next: (res) => {
        this.item = res.item;
        this.saved.emit(res.item);
        this.notifications.success('Status updated');
      },
      error: (err) => {
        this.notifications.error(err.error?.message || 'Failed to update status');
      },
    });
  }

  setPriority(priority: ProjectItemPriority) {
    if (!this.item || this.item.priority === priority) return;
    this.projectService.updateItem(this.projectId, this.item.id, { priority }).subscribe({
      next: (res) => {
        this.item = res.item;
        this.saved.emit(res.item);
        this.notifications.success('Priority updated');
      },
      error: (err) => {
        this.notifications.error(err.error?.message || 'Failed to update priority');
      },
    });
  }

  get assigneeLabel(): string {
    return this.item?.assignedTo?.username ? this.item.assignedTo.username : '-- Unassigned --';
  }

  selectAssignee(user: User | null) {
    if (!this.item || this.isGroup) return;
    const assignedTo = user ? user.id ?? user.id ?? null : null;
    this.projectService.updateItem(this.projectId, this.item.id, { assignedTo }).subscribe({
      next: (res) => {
        this.item = res.item;
        this.saved.emit(res.item);
        this.notifications.success('Assignee updated');
      },
      error: (err) => {
        this.notifications.error(err.error?.message || 'Failed to update assignee');
      },
    });
  }

  selectTags(tags: TagLite[]) {
    if (!this.item) return;
    this.projectService.updateItem(this.projectId, this.item.id, { tags: tags.map((t) => t.id) }).subscribe({
      next: (res) => {
        this.item = res.item;
        this.saved.emit(res.item);
        this.notifications.success('Tags updated');
      },
      error: (err) => {
        this.notifications.error(err.error?.message || 'Failed to update tags');
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
    this.projectService.updateItem(this.projectId, this.item.id, { startDate, endDate }).subscribe({
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
    const mentions = this.finalizeMentions(this.editForm.value.description ?? '', this.descriptionMentions);
    this.projectService.updateItem(this.projectId, this.item.id, { ...this.editForm.value, mentions }).subscribe({
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
    this.projectService.getComments(this.projectId, this.item.id).subscribe({
      next: (list) => {
        this.comments = list;
        this.commentsLoading = false;
        if (this.highlightCommentId != null) this.scrollToHighlightedComment();
      },
      error: () => (this.commentsLoading = false),
    });
  }

  // Runs after the comment list re-renders (setTimeout so the @for has
  // painted the new <li> elements first) — a notification's deep link only
  // needs to get the user's eyes on the right comment once per modal open.
  private scrollToHighlightedComment() {
    const id = this.highlightCommentId;
    setTimeout(() => {
      document.getElementById('comment-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  addComment() {
    const body = this.commentBody.trim();
    if (!body || !this.item) return;
    this.commentSubmitting = true;
    const mentions = this.finalizeMentions(body, this.commentMentions);
    this.projectService.addComment(this.projectId, this.item.id, { body, mentions }).subscribe({
      next: (res) => {
        this.comments = [...this.comments, res.comment];
        this.commentBody = '';
        this.commentMentions = [];
        this.commentSubmitting = false;
      },
      error: () => (this.commentSubmitting = false),
    });
  }

  deleteComment(comment: ProjectComment) {
    if (!this.item) return;
    this.projectService.deleteComment(this.projectId, this.item.id, comment.id).subscribe({
      next: () => (this.comments = this.comments.filter((c) => c.id !== comment.id)),
    });
  }

  startEditComment(comment: ProjectComment) {
    this.editingCommentId = comment.id;
    this.editCommentBody = comment.body;
    this.editCommentMentions = [...(comment.mentions ?? [])];
  }

  cancelEditComment() {
    this.editingCommentId = null;
    this.editCommentBody = '';
    this.editCommentMentions = [];
  }

  submitEditComment() {
    const body = this.editCommentBody.trim();
    if (!body || !this.item || this.editingCommentId == null) return;
    this.editCommentSubmitting = true;
    const mentions = this.finalizeMentions(body, this.editCommentMentions);
    this.projectService.updateComment(this.projectId, this.item.id, this.editingCommentId, { body, mentions }).subscribe({
      next: (res) => {
        this.comments = this.comments.map((c) => (c.id === res.comment.id ? res.comment : c));
        this.editCommentSubmitting = false;
        this.cancelEditComment();
      },
      error: () => (this.editCommentSubmitting = false),
    });
  }

  isOwnComment(comment: ProjectComment): boolean {
    const user = this.auth.getUser();
    if (!user) return false;
    const authorId = comment.author?.id ?? comment.author?.id;
    return authorId === user.id || authorId === user.id;
  }

  // Escapes the raw body first (it's free-typed user text), then highlights
  // each frozen mention's "@username" occurrence — longest username first so
  // e.g. replacing "@Jo" can't clobber a "@John" that contains it as a
  // substring. Safe to bypass sanitization since every dynamic piece here
  // (the body) was escaped by us before any markup was added.
  renderBody(comment: ProjectComment): SafeHtml {
    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let html = escapeHtml(comment.body);
    const mentions = [...(comment.mentions ?? [])].sort((a, b) => b.username.length - a.username.length);
    for (const m of mentions) {
      const pattern = new RegExp('@' + escapeRegExp(m.username), 'g');
      html = html.replace(pattern, `<span class="mention-pill">@${m.username}</span>`);
    }
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  // Other edits in this component (status/priority/assignee/tags/dates)
  // reassign `this.item` to a freshly-fetched object and rely on `saved`
  // so the parent's patchNode() re-syncs the tree node by id — a direct
  // mutation on `this.item` wouldn't reach the tree once that's happened.
  // Attachment count changes follow the same emit-based path for consistency.
  private setAttachmentCount(count: number) {
    if (!this.item) return;
    this.item.attachmentCount = count;
    this.saved.emit(this.item);
  }

  // silent=true skips the loading spinner — used by the background poll so
  // a countdown reaching 0 doesn't flash "Loading…" over the list.
  loadAttachments(silent = false) {
    if (!this.item || this.isGroup) return;
    if (!silent) this.attachmentsLoading = true;
    this.projectService.getAttachments(this.projectId, this.item.id).subscribe({
      next: (list) => {
        // A pending attachment that dropped out of the fresh list was
        // permanently deleted server-side (by the sweep) since the last
        // load — reflect that in the item's count now rather than waiting
        // for a full reload.
        const permanentlyDeleted = this.attachments.filter(
          (a) => a.pendingDeleteAt && !list.some((l) => l.id === a.id)
        ).length;
        this.attachments = list;
        this.attachmentsLoading = false;
        if (permanentlyDeleted > 0 && this.item) {
          this.setAttachmentCount(Math.max(0, this.item.attachmentCount - permanentlyDeleted));
        }
        this.syncAttachmentPolling();
      },
      error: () => (this.attachmentsLoading = false),
    });
  }

  // Keeps polling while a countdown is in flight so the list — and the
  // item's attachmentCount — pick up the permanent delete as soon as the
  // sweep on the server processes it, without the user having to refresh.
  private syncAttachmentPolling() {
    const hasPending = this.attachments.some((a) => a.pendingDeleteAt);
    if (hasPending && !this.pollHandle) {
      this.pollHandle = setInterval(() => this.loadAttachments(true), this.ATTACHMENTS_POLL_MS);
    } else if (!hasPending) {
      this.stopAttachmentsPolling();
    }
  }

  private stopAttachmentsPolling() {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = undefined;
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.item) return;

    this.attachmentUploading = true;
    this.attachmentUploadError = '';
    this.projectService
      .uploadAttachment(this.projectId, this.item.id, file)
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
              if (this.item) this.setAttachmentCount(this.item.attachmentCount + 1);
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

  toggleAddLink() {
    this.addLinkOpen = !this.addLinkOpen;
    this.addLinkError = '';
    if (!this.addLinkOpen) {
      this.linkUrlInput = '';
      this.linkLabelInput = '';
    }
  }

  submitLink() {
    if (!this.item) return;
    const url = this.linkUrlInput.trim();
    if (!url) return;
    this.addLinkLoading = true;
    this.addLinkError = '';
    this.projectService
      .addLinkAttachment(this.projectId, this.item.id, { url, fileName: this.linkLabelInput.trim() })
      .subscribe({
        next: (res) => {
          this.attachments = [res.attachment, ...this.attachments];
          if (this.item) this.setAttachmentCount(this.item.attachmentCount + 1);
          this.addLinkLoading = false;
          this.addLinkOpen = false;
          this.linkUrlInput = '';
          this.linkLabelInput = '';
        },
        error: (err) => {
          this.addLinkError = err.error?.message || 'Failed to add link';
          this.addLinkLoading = false;
        },
      });
  }

  download(attachment: Attachment) {
    if (!this.item) return;
    this.downloadingId = attachment.id;
    this.projectService.downloadAttachment(this.projectId, this.item.id, attachment.id).subscribe({
      next: (info) => {
        window.open(info.downloadUrl, '_blank');
        this.downloadingId = null;
      },
      error: () => (this.downloadingId = null),
    });
  }

  deleteAttachment(attachment: Attachment) {
    if (!this.item) return;
    this.projectService.deleteAttachment(this.projectId, this.item.id, attachment.id).subscribe({
      next: (res) => {
        this.attachments = this.attachments.map((a) => (a.id === res.attachment.id ? res.attachment : a));
        this.syncAttachmentPolling();
      },
    });
  }

  undoDeleteAttachment(attachment: Attachment) {
    if (!this.item) return;
    this.projectService.undoDeleteAttachment(this.projectId, this.item.id, attachment.id).subscribe({
      next: (res) => {
        this.attachments = this.attachments.map((a) => (a.id === res.attachment.id ? res.attachment : a));
        this.syncAttachmentPolling();
      },
    });
  }

  getAttachmentFileInfo = (attachment: Attachment) =>
    this.projectService.downloadAttachment(this.projectId, this.item!.id, attachment.id);

  openViewer(attachment: Attachment) {
    const index = this.attachments.findIndex((a) => a.id === attachment.id);
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
