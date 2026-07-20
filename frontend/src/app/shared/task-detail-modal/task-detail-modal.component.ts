import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Task, TaskStatus } from '../../models/task.model';
import { ModalDirective } from '../modal.directive';
import { AuthService } from '../../core/services/auth.service';
import { TagPillComponent } from '../tag-pill/tag-pill.component';
import { AppDatePipe } from '../pipes/app-date.pipe';

@Component({
  selector: 'app-task-detail-modal',
  standalone: true,
  imports: [AppDatePipe, FormsModule, ModalDirective, TagPillComponent],
  templateUrl: './task-detail-modal.component.html',
  styleUrl: './task-detail-modal.component.css',
})
export class TaskDetailModalComponent implements OnChanges {
  @Input() task: Task | null = null;
  @Input() subtasks: Task[] = [];
  @Input() subtaskLoading = false;
  @Input() subtaskError = '';
  @Input() canDeleteTask = false;

  @Output() closed = new EventEmitter<void>();
  @Output() statusChange = new EventEmitter<TaskStatus>();
  @Output() editRequested = new EventEmitter<void>();
  @Output() deleteRequested = new EventEmitter<void>();
  @Output() subtaskAdd = new EventEmitter<string>();
  @Output() subtaskDelete = new EventEmitter<number>();

  subtaskTitle = '';
  private wasSubtaskLoading = false;
  assigneeAvatarBroken = false;
  creatorAvatarBroken = false;

  constructor(public auth: AuthService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['task']) {
      this.subtaskTitle = '';
      this.assigneeAvatarBroken = false;
      this.creatorAvatarBroken = false;
    }
    if (changes['subtaskLoading']) {
      if (this.wasSubtaskLoading && !this.subtaskLoading && !this.subtaskError) {
        this.subtaskTitle = '';
      }
      this.wasSubtaskLoading = this.subtaskLoading;
    }
  }

  addSubtask() {
    const title = this.subtaskTitle.trim();
    if (!title) return;
    this.subtaskAdd.emit(title);
  }
}
