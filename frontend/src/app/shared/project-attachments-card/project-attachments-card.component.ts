import { Component, Input, OnInit } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { ProjectService } from '../../core/services/project.service';
import { Attachment, ACCEPTED_ATTACHMENT_TYPES } from '../../models/attachment.model';
import { AttachmentViewerComponent } from '../attachment-viewer/attachment-viewer.component';

@Component({
  selector: 'app-project-attachments-card',
  standalone: true,
  imports: [AttachmentViewerComponent],
  templateUrl: './project-attachments-card.component.html',
  styleUrl: './project-attachments-card.component.css',
})
export class ProjectAttachmentsCardComponent implements OnInit {
  @Input({ required: true }) projectId!: string;

  readonly acceptedFileTypes = ACCEPTED_ATTACHMENT_TYPES;

  attachments: Attachment[] = [];
  attachmentsLoading = false;
  attachmentsError = '';
  uploading = false;
  uploadError = '';
  progress = 0;
  downloadingId = '';
  viewerOpen = false;
  viewerIndex = 0;

  constructor(private projectService: ProjectService) {}

  ngOnInit() {
    this.loadAttachments();
  }

  loadAttachments() {
    this.attachmentsLoading = true;
    this.attachmentsError = '';
    this.projectService.getProjectAttachments(this.projectId).subscribe({
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
    if (!file) return;

    this.uploading = true;
    this.uploadError = '';
    this.progress = 0;
    this.projectService.uploadProjectAttachment(this.projectId, file).subscribe({
      next: (res) => {
        switch (res.type) {
          case HttpEventType.UploadProgress:
            if (res.total) this.progress = Math.round((100 * res.loaded) / res.total);
            break;
          case HttpEventType.Response:
            this.attachments = [res.body.attachment, ...this.attachments];
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

  download(attachment: Attachment) {
    this.downloadingId = attachment._id;
    this.projectService.downloadProjectAttachment(this.projectId, attachment._id).subscribe({
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
    this.projectService.deleteProjectAttachment(this.projectId, attachment._id).subscribe({
      next: () => (this.attachments = this.attachments.filter((a) => a._id !== attachment._id)),
    });
  }

  loadAttachmentBlob = (attachment: Attachment) =>
    this.projectService.downloadProjectAttachment(this.projectId, attachment._id);

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
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'bi-file-earmark-spreadsheet';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'bi-file-earmark-slides';
    if (mimeType.startsWith('video/')) return 'bi-file-earmark-play';
    if (mimeType.startsWith('text/')) return 'bi-file-earmark-text';
    return 'bi-file-earmark';
  }
}
