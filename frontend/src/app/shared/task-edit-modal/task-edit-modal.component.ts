import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import dayjs from 'dayjs/esm';
import { UpdateTaskPayload } from '../../models/task.model';
import { Tag, TagLite } from '../../models/tag.model';
import { ModalDirective } from '../modal.directive';
import { TagPickerComponent } from '../tag-picker/tag-picker.component';
import { DatePickerComponent } from '../date-picker/date-picker.component';

export interface TaskEditInitial {
  title: string;
  description: string;
  status: string;
  startDate?: string | null;
  dueDate?: string | null;
  tags: TagLite[];
}

@Component({
  selector: 'app-task-edit-modal',
  standalone: true,
  imports: [ReactiveFormsModule, ModalDirective, TagPickerComponent, DatePickerComponent],
  templateUrl: './task-edit-modal.component.html',
  styleUrl: './task-edit-modal.component.css',
})
export class TaskEditModalComponent implements OnChanges {
  @Input() open = false;
  @Input() initial: TaskEditInitial | null = null;
  @Input() allTags: Tag[] = [];
  @Input() loading = false;
  @Input() error = '';

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<UpdateTaskPayload>();
  @Output() tagCreated = new EventEmitter<Tag>();

  form: FormGroup;
  selectedTags: TagLite[] = [];
  startDate: string | null = null;
  dueDate: string | null = null;

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      title: ['', Validators.required],
      description: [''],
      status: ['todo'],
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.form.reset({
        title: this.initial?.title ?? '',
        description: this.initial?.description ?? '',
        status: this.initial?.status ?? 'todo',
      });
      this.selectedTags = this.initial?.tags ?? [];
      this.startDate = this.initial?.startDate ? dayjs(this.initial.startDate).format('YYYY-MM-DD') : null;
      this.dueDate = this.initial?.dueDate ? dayjs(this.initial.dueDate).format('YYYY-MM-DD') : null;
    }
  }

  selectStatus(status: string) {
    this.form.get('status')?.setValue(status);
  }

  onTagsChange(tags: TagLite[]) {
    this.selectedTags = tags;
  }

  onTagCreated(tag: Tag) {
    this.tagCreated.emit(tag);
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitted.emit({
      ...this.form.value,
      startDate: this.startDate ? dayjs(this.startDate, 'YYYY-MM-DD').toISOString() : null,
      dueDate: this.dueDate ? dayjs(this.dueDate, 'YYYY-MM-DD').toISOString() : null,
      tags: this.selectedTags.map((t) => t.id),
    });
  }
}
