import { Component, Input } from '@angular/core';
import { ProjectService } from '../../core/services/project.service';
import { AttachmentsComponent } from '../attachments/attachments.component';

@Component({
  selector: 'app-project-attachments-card',
  standalone: true,
  imports: [AttachmentsComponent],
  templateUrl: './project-attachments-card.component.html',
  styleUrl: './project-attachments-card.component.css',
})
export class ProjectAttachmentsCardComponent {
  @Input({ required: true }) projectId!: string;

  constructor(public projectService: ProjectService) {}
}
