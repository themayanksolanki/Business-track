import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ProjectService } from '../../core/services/project.service';
import { Project, ProjectPlan } from '../../models/project.model';
import { Attachment, ACCEPTED_ATTACHMENT_TYPES } from '../../models/attachment.model';
import { AttachmentViewerComponent } from '../attachment-viewer/attachment-viewer.component';

@Component({
  selector: 'app-project-plan-card',
  standalone: true,
  imports: [AttachmentViewerComponent],
  templateUrl: './project-plan-card.component.html',
  styleUrl: './project-plan-card.component.css',
})
export class ProjectPlanCardComponent {
  @Input({ required: true }) projectId!: string;
  @Input() plan: ProjectPlan | null = null;

  @Output() planChanged = new EventEmitter<Project>();

  readonly acceptedFileTypes = ACCEPTED_ATTACHMENT_TYPES;

  uploading = false;
  uploadError = '';
  downloading = false;
  removing = false;
  viewerOpen = false;

  constructor(private projectService: ProjectService) {}

  // The plan isn't an Attachment row (it's flattened onto the project), so
  // it's adapted into the shape app-attachment-viewer expects to reuse its
  // image/PDF preview instead of building a second viewer just for this.
  get planAsAttachment(): Attachment[] {
    if (!this.plan) return [];
    return [
      {
        id: 0,
        fileName: this.plan.fileName,
        url: this.plan.url,
        mimeType: this.plan.mimeType,
        size: this.plan.size,
        uploadedBy: null as unknown as Attachment['uploadedBy'],
        createdAt: this.plan.uploadedAt ?? '',
      },
    ];
  }

  getPlanFileInfo = (_: Attachment) => this.projectService.downloadProjectPlan(this.projectId);

  openViewer() {
    if (!this.plan) return;
    this.viewerOpen = true;
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploading = true;
    this.uploadError = '';
    this.projectService.uploadProjectPlan(this.projectId, file).subscribe({
      next: (res) => {
        this.uploading = false;
        input.value = '';
        this.planChanged.emit(res.project);
      },
      error: (err) => {
        this.uploadError = err.error?.message || 'Failed to upload file';
        this.uploading = false;
        input.value = '';
      },
    });
  }

  download() {
    if (!this.plan) return;
    this.downloading = true;
    this.projectService.downloadProjectPlan(this.projectId).subscribe({
      next: (info) => {
        window.open(info.downloadUrl, '_blank');
        this.downloading = false;
      },
      error: () => (this.downloading = false),
    });
  }

  remove() {
    this.removing = true;
    this.projectService.removeProjectPlan(this.projectId).subscribe({
      next: (res) => {
        this.removing = false;
        this.planChanged.emit(res.project);
      },
      error: () => (this.removing = false),
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  fileIcon(mimeType: string): string {
    if (mimeType === 'application/pdf') return 'bi-file-earmark-pdf';
    if (mimeType.includes('word')) return 'bi-file-earmark-word';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'bi-file-earmark-spreadsheet';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'bi-file-earmark-slides';
    return 'bi-file-earmark';
  }
}
