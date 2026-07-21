import { Component, Input, Output, EventEmitter, OnChanges, OnInit, OnDestroy, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectService } from '../../core/services/project.service';
import { ProjectItem } from '../../models/project-item.model';
import { Attachment } from '../../models/attachment.model';
import { HttpEventType } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { AttachmentViewerComponent } from '../attachment-viewer/attachment-viewer.component';

@Component({
  selector: 'app-attachment-panel',
  standalone: true,
  imports: [FormsModule, CommonModule, AttachmentViewerComponent],
  templateUrl: './attachment-panel.component.html',
  styleUrl: './attachment-panel.component.css',
})
export class AttachmentPanelComponent implements OnChanges, OnInit, OnDestroy {
  @Input({ required: true }) projectId!: string;
  @Input({ required: true }) item!: ProjectItem;
  // Role-based permission — false hides upload/add-link/delete controls,
  // leaving list/preview/download visible for a view-only user.
  @Input() canEdit = true;

  @Output() closed = new EventEmitter<void>();

  attachments: Attachment[] = [];
  attachmentsLoading = false;
  attachmentUploading = false;
  attachmentUploadError = '';
  downloadingId: number | null = null;
  progress = 0;
  viewerOpen = false;
  viewerIndex = 0;

  addLinkOpen = false;
  linkUrlInput = '';
  linkLabelInput = '';
  addLinkLoading = false;
  addLinkError = '';

  // Presentation-only clock the countdown badges read from — the actual
  // deletion is driven server-side off pendingDeleteAt, this just ticks the
  // displayed "Xs" down each second.
  private now = Date.now();
  private tickHandle?: ReturnType<typeof setInterval>;
  private pollHandle?: ReturnType<typeof setInterval>;
  // Matches the backend's countdown (see PENDING_DELETE_MS in
  // attachmentController.js) — frequent enough that the list catches up
  // shortly after the badge hits 0, without polling constantly.
  private readonly POLL_MS = 2000;

  constructor(private projectService: ProjectService) {}

  ngOnInit() {
    this.tickHandle = setInterval(() => (this.now = Date.now()), 1000);
  }

  ngOnDestroy() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.stopPolling();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['item'] && this.item && changes['item'].firstChange) {
      this.loadAttachments();
    }
  }

  isPending(a: Attachment): boolean {
    return !!a.pendingDeleteAt && new Date(a.pendingDeleteAt).getTime() > this.now;
  }

  remainingSeconds(a: Attachment): number {
    if (!a.pendingDeleteAt) return 0;
    return Math.max(0, Math.ceil((new Date(a.pendingDeleteAt).getTime() - this.now) / 1000));
  }

  // silent=true skips the loading spinner — used by the background poll so
  // a countdown reaching 0 doesn't flash "Loading…" over the list.
  loadAttachments(silent = false) {
    if (!silent) this.attachmentsLoading = true;
    this.projectService
      .getAttachments(this.projectId, this.item.id)
      .subscribe({
        next: (list) => {
          // A pending attachment that dropped out of the fresh list was
          // permanently deleted server-side (by the sweep) since the last
          // load — reflect that in the count now rather than waiting for a
          // full item reload.
          const permanentlyDeleted = this.attachments.filter(
            (a) => a.pendingDeleteAt && !list.some((l) => l.id === a.id)
          ).length;
          this.attachments = list;
          this.attachmentsLoading = false;
          if (permanentlyDeleted > 0) {
            this.item.attachmentCount = Math.max(0, this.item.attachmentCount - permanentlyDeleted);
          }
          this.syncPolling();
        },
        error: () => (this.attachmentsLoading = false),
      });
  }

  // Keeps polling while a countdown is in flight so the list — and the
  // item's attachmentCount — pick up the permanent delete as soon as the
  // sweep on the server processes it, without the user having to refresh.
  private syncPolling() {
    const hasPending = this.attachments.some((a) => a.pendingDeleteAt);
    if (hasPending && !this.pollHandle) {
      this.pollHandle = setInterval(() => this.loadAttachments(true), this.POLL_MS);
    } else if (!hasPending) {
      this.stopPolling();
    }
  }

  private stopPolling() {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = undefined;
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

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
              this.item.attachmentCount += 1;
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
    const url = this.linkUrlInput.trim();
    if (!url) return;
    this.addLinkLoading = true;
    this.addLinkError = '';
    this.projectService
      .addLinkAttachment(this.projectId, this.item.id, { url, fileName: this.linkLabelInput.trim() })
      .subscribe({
        next: (res) => {
          this.attachments = [res.attachment, ...this.attachments];
          this.item.attachmentCount += 1;
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
    this.downloadingId = attachment.id;
    this.projectService
      .downloadAttachment(this.projectId, this.item.id, attachment.id)
      .subscribe({
        next: (info) => {
          window.open(info.downloadUrl, '_blank');
          this.downloadingId = null;
        },
        error: () => (this.downloadingId = null),
      });
  }

  deleteAttachment(attachment: Attachment) {
    this.projectService
      .deleteAttachment(this.projectId, this.item.id, attachment.id)
      .subscribe({
        next: (res) => {
          this.attachments = this.attachments.map((a) => (a.id === res.attachment.id ? res.attachment : a));
          this.syncPolling();
        },
      });
  }

  undoDeleteAttachment(attachment: Attachment) {
    this.projectService
      .undoDeleteAttachment(this.projectId, this.item.id, attachment.id)
      .subscribe({
        next: (res) => {
          this.attachments = this.attachments.map((a) => (a.id === res.attachment.id ? res.attachment : a));
          this.syncPolling();
        },
      });
  }

  getAttachmentFileInfo = (attachment: Attachment) =>
    this.projectService.downloadAttachment(this.projectId, this.item.id, attachment.id);

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
    if (mimeType === 'application/pdf') return 'bi-file-earmark-pdf';
    if (mimeType.includes('zip')) return 'bi-file-earmark-zip';
    if (mimeType.includes('word')) return 'bi-file-earmark-word';
    if (mimeType.includes('sheet') || mimeType.includes('excel'))
      return 'bi-file-earmark-spreadsheet';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint'))
      return 'bi-file-earmark-slides';
    if (mimeType.startsWith('text/')) return 'bi-file-earmark-text';
    return 'bi-file-earmark';
  }

  isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }
}
