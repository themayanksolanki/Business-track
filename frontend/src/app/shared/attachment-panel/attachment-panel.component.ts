import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ProjectService } from '../../core/services/project.service';
import { ProjectItem } from '../../models/project-item.model';
import { Attachment } from '../../models/attachment.model';
import { AttachmentsComponent } from '../attachments/attachments.component';

@Component({
  selector: 'app-attachment-panel',
  standalone: true,
  imports: [AttachmentsComponent],
  templateUrl: './attachment-panel.component.html',
  styleUrl: './attachment-panel.component.css',
})
export class AttachmentPanelComponent {
  @Input({ required: true }) projectId!: string;
  @Input({ required: true }) item!: ProjectItem;
  // Role-based permission — false hides upload/add-link/delete controls,
  // leaving list/preview/download visible for a view-only user.
  @Input() canEdit = true;

  @Output() closed = new EventEmitter<void>();

  constructor(public projectService: ProjectService) {}

  onAttachmentsChange(attachments: Attachment[]) {
    this.item.attachmentCount = attachments.length;
  }
}
