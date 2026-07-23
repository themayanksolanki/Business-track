import { Component, Input, OnInit } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { ProjectService } from '../../core/services/project.service';
import { Attachment, ACCEPTED_ATTACHMENT_TYPES } from '../../models/attachment.model';
import { AttachmentViewerComponent } from '../attachment-viewer/attachment-viewer.component';
import { AttachmentThumbComponent } from '../attachment-thumb/attachment-thumb.component';

@Component({
  selector: 'app-project-attachments-card',
  standalone: true,
  imports: [AttachmentViewerComponent, AttachmentThumbComponent],
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
  downloadingId: number | null = null;
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
    this.downloadingId = attachment.id;
    this.projectService.downloadProjectAttachment(this.projectId, attachment.id).subscribe({
      next: (info) => {
        window.open(info.downloadUrl, '_blank');
        this.downloadingId = null;
      },
      error: () => (this.downloadingId = null),
    });
  }

  deleteAttachment(attachment: Attachment) {
    this.projectService.deleteProjectAttachment(this.projectId, attachment.id).subscribe({
      next: () => (this.attachments = this.attachments.filter((a) => a.id !== attachment.id)),
    });
  }

  getAttachmentFileInfo = (attachment: Attachment) =>
    this.projectService.downloadProjectAttachment(this.projectId, attachment.id);

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
