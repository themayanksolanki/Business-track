import {
  Component, Input, Output, EventEmitter, OnChanges, OnInit, OnDestroy, SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { Attachment, AttachmentsAdapter, ACCEPTED_ATTACHMENT_TYPES, DownloadInfo } from '../../models/attachment.model';
import { AttachmentViewerComponent } from '../attachment-viewer/attachment-viewer.component';
import { AttachmentThumbComponent } from '../attachment-thumb/attachment-thumb.component';
import { Observable } from 'rxjs';

// Single reusable attachment grid — upload, download, delete (with the
// soft-delete/undo countdown when the adapter supports it), add-link, and
// preview — driven entirely by an AttachmentsAdapter so it can be dropped
// into a task modal, a project card, a project-item popover, an event
// dialog, or a metric tab without any of them re-implementing this logic.
@Component({
  selector: 'app-attachments',
  standalone: true,
  imports: [CommonModule, FormsModule, AttachmentViewerComponent, AttachmentThumbComponent],
  templateUrl: './attachments.component.html',
  styleUrl: './attachments.component.css',
})
export class AttachmentsComponent implements OnChanges, OnInit, OnDestroy {
  @Input({ required: true }) adapter!: AttachmentsAdapter;
  // The id of whatever entity `adapter` targets (task.id, projectId, item.id,
  // event.id, metric.id) — reload is keyed off this changing, not off
  // `adapter`'s object identity, since a fresh adapter object is cheap to
  // construct on every change-detection pass.
  @Input({ required: true }) reloadKey!: string | number;
  @Input() canEdit = true;
  @Input() emptyMessage = 'No files uploaded yet.';

  @Output() attachmentsChange = new EventEmitter<Attachment[]>();

  readonly acceptedFileTypes = ACCEPTED_ATTACHMENT_TYPES;

  attachments: Attachment[] = [];
  attachmentsLoading = false;
  attachmentsError = '';
  uploading = false;
  uploadError = '';
  progress = 0;
  downloadingId: number | null = null;
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
  // attachmentController.ts) — frequent enough that the list catches up
  // shortly after the badge hits 0, without polling constantly.
  private readonly POLL_MS = 2000;

  get supportsUndo(): boolean {
    return !!this.adapter.undoDelete;
  }

  get supportsLink(): boolean {
    return !!this.adapter.addLink;
  }

  ngOnInit() {
    this.tickHandle = setInterval(() => (this.now = Date.now()), 1000);
  }

  ngOnDestroy() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.stopPolling();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['reloadKey']) {
      this.resetAddLinkForm();
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
    if (!silent) {
      this.attachmentsLoading = true;
      this.attachmentsError = '';
    }
    this.adapter.list().subscribe({
      next: (list) => {
        this.attachments = list;
        this.attachmentsLoading = false;
        this.attachmentsChange.emit(this.attachments);
        this.syncPolling();
      },
      error: (err) => {
        if (!silent) this.attachmentsError = err.error?.message || 'Failed to load attachments';
        this.attachmentsLoading = false;
      },
    });
  }

  // Keeps polling while a countdown is in flight so the list picks up the
  // permanent delete as soon as the sweep on the server processes it,
  // without the user having to refresh. A no-op for adapters that never
  // produce a pendingDeleteAt (immediate-delete backends).
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

    this.uploading = true;
    this.uploadError = '';
    this.progress = 0;
    this.adapter.upload(file).subscribe({
      next: (res) => {
        switch (res.type) {
          case HttpEventType.UploadProgress:
            if (res.total) this.progress = Math.round((100 * res.loaded) / res.total);
            break;
          case HttpEventType.Response:
            if (res.body) {
              this.attachments = [res.body.attachment, ...this.attachments];
              this.attachmentsChange.emit(this.attachments);
            }
            this.uploading = false;
            input.value = '';
            break;
        }
      },
      error: (err) => {
        this.uploadError = err.error?.message || 'Failed to upload file';
        this.uploading = false;
        input.value = '';
      },
    });
  }

  toggleAddLink() {
    this.addLinkOpen = !this.addLinkOpen;
    this.addLinkError = '';
    if (!this.addLinkOpen) this.resetAddLinkForm();
  }

  submitLink() {
    const url = this.linkUrlInput.trim();
    if (!url || !this.adapter.addLink) return;
    this.addLinkLoading = true;
    this.addLinkError = '';
    this.adapter.addLink({ url, fileName: this.linkLabelInput.trim() }).subscribe({
      next: (res) => {
        this.attachments = [res.attachment, ...this.attachments];
        this.attachmentsChange.emit(this.attachments);
        this.addLinkLoading = false;
        this.addLinkOpen = false;
        this.resetAddLinkForm();
      },
      error: (err) => {
        this.addLinkError = err.error?.message || 'Failed to add link';
        this.addLinkLoading = false;
      },
    });
  }

  private resetAddLinkForm() {
    this.linkUrlInput = '';
    this.linkLabelInput = '';
  }

  download(attachment: Attachment) {
    this.downloadingId = attachment.id;
    this.adapter.download(attachment).subscribe({
      next: (info) => {
        window.open(info.downloadUrl, '_blank');
        this.downloadingId = null;
      },
      error: () => (this.downloadingId = null),
    });
  }

  deleteAttachment(attachment: Attachment) {
    this.adapter.delete(attachment).subscribe({
      next: (res) => {
        if (res.attachment) {
          // Soft-delete backend: row stays, now carries a pendingDeleteAt.
          this.attachments = this.attachments.map((a) => (a.id === res.attachment!.id ? res.attachment! : a));
          this.syncPolling();
        } else {
          // Immediate-delete backend: row is gone server-side already.
          this.attachments = this.attachments.filter((a) => a.id !== attachment.id);
        }
        this.attachmentsChange.emit(this.attachments);
      },
    });
  }

  undoDeleteAttachment(attachment: Attachment) {
    if (!this.adapter.undoDelete) return;
    this.adapter.undoDelete(attachment).subscribe({
      next: (res) => {
        this.attachments = this.attachments.map((a) => (a.id === res.attachment.id ? res.attachment : a));
        this.syncPolling();
        this.attachmentsChange.emit(this.attachments);
      },
    });
  }

  getAttachmentFileInfo = (attachment: Attachment): Observable<DownloadInfo> =>
    this.adapter.download(attachment);

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
}
