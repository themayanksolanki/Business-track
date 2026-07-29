import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AttachmentService } from '../../core/services/attachment.service';
import { Attachment } from '../../models/attachment.model';
import { Task } from '../../models/task.model';
import { ModalDirective } from '../modal.directive';
import { AttachmentsComponent } from '../attachments/attachments.component';

@Component({
  selector: 'app-task-attachments-modal',
  standalone: true,
  imports: [ModalDirective, AttachmentsComponent],
  templateUrl: './task-attachments-modal.component.html',
  styleUrl: './task-attachments-modal.component.css',
})
export class TaskAttachmentsModalComponent {
  @Input() open = false;
  @Input() task: Task | null = null;

  @Output() closed = new EventEmitter<void>();

  constructor(public attachmentService: AttachmentService) {}

  onAttachmentsChange(attachments: Attachment[]) {
    if (this.task) this.task.attachmentCount = attachments.length;
  }
}
