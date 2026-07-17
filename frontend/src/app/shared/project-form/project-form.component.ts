import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import dayjs from 'dayjs/esm';
import { Department } from '../../models/department.model';
import { Category } from '../../models/category.model';
import { CreateProjectPayload, ProjectPriority, ProjectEffort } from '../../models/project.model';
import { Tag, TagLite } from '../../models/tag.model';
import { User } from '../../models/user.model';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import { TimePickerComponent } from '../time-picker/time-picker.component';
import { ModalDirective } from '../modal.directive';
import { TagPickerComponent } from '../tag-picker/tag-picker.component';

@Component({
  selector: 'app-project-form',
  standalone: true,
  imports: [ReactiveFormsModule, DatePickerComponent, TimePickerComponent, ModalDirective, TagPickerComponent],
  templateUrl: './project-form.component.html',
  styleUrl: './project-form.component.css',
})
export class ProjectFormComponent implements OnChanges {
  @Input() open = false;
  @Input() departments: Department[] = [];
  @Input() categories: Category[] = [];
  @Input() allTags: Tag[] = [];
  @Input() users: User[] = [];
  @Input() loading = false;
  @Input() error = '';

  readonly priorityOptions: ProjectPriority[] = ['low', 'medium', 'high'];
  readonly effortOptions: ProjectEffort[] = ['low', 'medium', 'high'];

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<CreateProjectPayload>();
  @Output() tagCreated = new EventEmitter<Tag>();

  form: FormGroup;
  startDate: string | null = null;
  startTime: string | null = null;
  endDate: string | null = null;
  endTime: string | null = null;
  selectedTags: TagLite[] = [];

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      department: [''],
      category: [''],
      owner: [''],
      priority: [''],
      effort: [''],
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.form.reset({ name: '', description: '', department: '', category: '', owner: '', priority: '', effort: '' });
      this.startDate = null;
      this.startTime = null;
      this.endDate = null;
      this.endTime = null;
      this.selectedTags = [];
    }
  }

  private combineDateTime(date: string | null, time: string | null): string | null {
    if (!date) return null;
    return dayjs(`${date} ${time || '00:00'}`, 'YYYY-MM-DD HH:mm').toISOString();
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const payload: CreateProjectPayload = {
      ...this.form.value,
      department: this.form.value.department || null,
      category: this.form.value.category || null,
      owner: this.form.value.owner || null,
      priority: this.form.value.priority || undefined,
      effort: this.form.value.effort || undefined,
      startDate: this.combineDateTime(this.startDate, this.startTime),
      endDate: this.combineDateTime(this.endDate, this.endTime),
      tags: this.selectedTags.map((t) => t._id),
    };
    this.submitted.emit(payload);
  }

  onTagsChange(tags: TagLite[]) {
    this.selectedTags = tags;
  }

  onTagCreated(tag: Tag) {
    this.tagCreated.emit(tag);
  }
}
