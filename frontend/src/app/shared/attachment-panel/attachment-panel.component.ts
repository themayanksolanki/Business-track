import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
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
export class AttachmentPanelComponent implements OnChanges {
  @Input({ required: true }) projectId!: string;
  @Input({ required: true }) item!: ProjectItem;

  @Output() closed = new EventEmitter<void>();

  attachments: Attachment[] = [];
  attachmentsLoading = false;
  attachmentUploading = false;
  attachmentUploadError = '';
  downloadingId = '';
  progress = 0;
  viewerOpen = false;
  viewerIndex = 0;

  constructor(private projectService: ProjectService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['item'] && this.item && changes['item'].firstChange) {
      this.loadAttachments();
    }
  }

  loadAttachments() {
    this.attachmentsLoading = true;
    this.projectService
      .getAttachments(this.projectId, this.item._id)
      .subscribe({
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
    if (!file) return;

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
    this.downloadingId = attachment._id;
    this.projectService
      .downloadAttachment(this.projectId, this.item._id, attachment._id)
      .subscribe({
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
    this.projectService
      .deleteAttachment(this.projectId, this.item._id, attachment._id)
      .subscribe({
        next: () =>
          (this.attachments = this.attachments.filter(
            (a) => a._id !== attachment._id,
          )),
      });
  }

  loadAttachmentBlob = (attachment: Attachment) =>
    this.projectService.downloadAttachment(this.projectId, this.item._id, attachment._id);

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
