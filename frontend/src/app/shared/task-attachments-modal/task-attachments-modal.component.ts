import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { Attachment, ACCEPTED_ATTACHMENT_TYPES } from '../../models/attachment.model';
import { Task } from '../../models/task.model';
import { ModalDirective } from '../modal.directive';

@Component({
  selector: 'app-task-attachments-modal',
  standalone: true,
  imports: [ModalDirective],
  templateUrl: './task-attachments-modal.component.html',
  styleUrl: './task-attachments-modal.component.css',
})
export class TaskAttachmentsModalComponent implements OnChanges {
  @Input() open = false;
  @Input() task: Task | null = null;
  @Input() attachments: Attachment[] = [];
  @Input() loading = false;
  @Input() error = '';
  @Input() uploading = false;
  @Input() uploadError = '';
  @Input() downloadingId = '';

  @Output() closed = new EventEmitter<void>();
  @Output() fileSelected = new EventEmitter<File>();
  @Output() download = new EventEmitter<Attachment>();
  @Output() viewRequested = new EventEmitter<Attachment>();

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;

  readonly acceptedFileTypes = ACCEPTED_ATTACHMENT_TYPES;

  private wasUploading = false;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['uploading']) {
      if (this.wasUploading && !this.uploading && this.fileInputRef) {
        this.fileInputRef.nativeElement.value = '';
      }
      this.wasUploading = this.uploading;
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.fileSelected.emit(file);
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
