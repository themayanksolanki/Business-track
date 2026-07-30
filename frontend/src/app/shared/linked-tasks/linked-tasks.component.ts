import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LinkedTask, LinkedTasksAdapter } from '../../models/project-item.model';
import { TaskPickerDialogComponent } from '../task-picker-dialog/task-picker-dialog.component';

// Self-contained "Tasks" panel — list of tasks linked to some parent entity
// (an event today; per a planned future feature, a metric too) plus a
// "+ Task" button opening <app-task-picker-dialog>, driven entirely by a
// LinkedTasksAdapter so neither this component nor the picker dialog need
// to know what kind of parent they're attached to. Mirrors <app-attachments>'
// adapter/reloadKey/canEdit contract (see attachments.component.ts).
@Component({
  selector: 'app-linked-tasks',
  standalone: true,
  imports: [CommonModule, TaskPickerDialogComponent],
  templateUrl: './linked-tasks.component.html',
  styleUrl: './linked-tasks.component.css',
})
export class LinkedTasksComponent implements OnChanges {
  @Input({ required: true }) adapter!: LinkedTasksAdapter;
  // The id of whatever entity `adapter` targets — reload is keyed off this
  // changing, not off `adapter`'s object identity (see attachments.component.ts's
  // identical convention).
  @Input({ required: true }) reloadKey!: string | number;
  @Input() canEdit = true;
  @Input() emptyMessage = 'No tasks linked yet.';

  @Output() tasksChange = new EventEmitter<LinkedTask[]>();

  tasks: LinkedTask[] = [];
  loading = false;
  error = '';
  unlinkingId: number | null = null;
  pickerOpen = false;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['reloadKey']) this.load();
  }

  get excludeTaskIds(): number[] {
    return this.tasks.map((t) => t.id);
  }

  load() {
    this.loading = true;
    this.error = '';
    this.adapter.list().subscribe({
      next: (tasks) => {
        this.tasks = tasks;
        this.loading = false;
        this.tasksChange.emit(this.tasks);
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load tasks';
        this.loading = false;
      },
    });
  }

  openPicker() {
    this.error = '';
    this.pickerOpen = true;
  }

  onTasksPicked(projectItemIds: number[]) {
    this.pickerOpen = false;
    if (!projectItemIds.length) return;
    this.adapter.link(projectItemIds).subscribe({
      next: (res) => {
        this.tasks = res.tasks;
        this.tasksChange.emit(this.tasks);
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to link tasks';
      },
    });
  }

  unlink(task: LinkedTask) {
    this.unlinkingId = task.id;
    this.adapter.unlink(task.id).subscribe({
      next: () => {
        this.tasks = this.tasks.filter((t) => t.id !== task.id);
        this.unlinkingId = null;
        this.tasksChange.emit(this.tasks);
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to unlink task';
        this.unlinkingId = null;
      },
    });
  }
}
