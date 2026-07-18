import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ProjectService } from '../../core/services/project.service';
import { Project, ProjectPlan } from '../../models/project.model';
import { ACCEPTED_ATTACHMENT_TYPES } from '../../models/attachment.model';

@Component({
  selector: 'app-project-plan-card',
  standalone: true,
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

  constructor(private projectService: ProjectService) {}

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
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = this.plan!.fileName;
        link.click();
        window.URL.revokeObjectURL(url);
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
