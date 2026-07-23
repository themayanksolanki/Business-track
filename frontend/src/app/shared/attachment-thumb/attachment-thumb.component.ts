import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { Observable } from 'rxjs';
import { Attachment, DownloadInfo } from '../../models/attachment.model';
import { attachmentExt, attachmentFileIcon, isImageAttachment } from '../attachment-icon.util';

// Square thumbnail tile shared by every attachment-list surface
// (attachment-panel, project-item-detail, project-attachments-card,
// task-attachments-modal): an image preview for image files, a
// file-type-icon box for everything else. A pasted link always gets the
// link icon regardless of guessed mime type, matching each surface's
// pre-existing row-icon behavior.
@Component({
  selector: 'app-attachment-thumb',
  standalone: true,
  templateUrl: './attachment-thumb.component.html',
  styleUrl: './attachment-thumb.component.css',
})
export class AttachmentThumbComponent implements OnChanges {
  @Input({ required: true }) attachment!: Attachment;
  @Input({ required: true }) getFileInfo!: (attachment: Attachment) => Observable<DownloadInfo>;

  imageUrl: string | null = null;
  imageLoading = false;
  imageFailed = false;

  get isImage(): boolean {
    return this.attachment.kind !== 'link' && isImageAttachment(this.attachment.mimeType);
  }

  get icon(): string {
    return this.attachment.kind === 'link' ? 'bi-link-45deg' : attachmentFileIcon(this.attachment.mimeType);
  }

  get ext(): string {
    return attachmentExt(this.attachment.fileName);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['attachment']) {
      this.imageUrl = null;
      this.imageFailed = false;
      this.loadImageIfNeeded();
    }
  }

  private loadImageIfNeeded() {
    if (!this.isImage || this.imageUrl || this.imageLoading) return;
    this.imageLoading = true;
    this.getFileInfo(this.attachment).subscribe({
      next: (info) => {
        this.imageUrl = info.viewUrl;
        this.imageLoading = false;
      },
      error: () => {
        this.imageFailed = true;
        this.imageLoading = false;
      },
    });
  }
}
