import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ModalDirective } from '../modal.directive';
import { ProjectTreeNode } from '../../models/project-item.model';

@Component({
  selector: 'app-move-to-group-dialog',
  standalone: true,
  imports: [ModalDirective],
  templateUrl: './move-to-group-dialog.component.html',
  styleUrl: './move-to-group-dialog.component.css',
})
export class MoveToGroupDialogComponent {
  @Input() open = false;
  @Input() groups: ProjectTreeNode[] = [];
  @Input() loading = false;
  @Input() currentGroupId: number | null = null;

  @Output() groupSelected = new EventEmitter<number>();
  @Output() cancelled = new EventEmitter<void>();
}
