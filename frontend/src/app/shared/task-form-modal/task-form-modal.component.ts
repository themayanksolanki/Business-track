import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CreateTaskPayload } from '../../models/task.model';
import { Tag, TagLite } from '../../models/tag.model';
import { User } from '../../models/user.model';
import { ModalDirective } from '../modal.directive';
import { AuthService } from '../../core/services/auth.service';
import { TagPickerComponent } from '../tag-picker/tag-picker.component';

@Component({
  selector: 'app-task-form-modal',
  standalone: true,
  imports: [ReactiveFormsModule, ModalDirective, TagPickerComponent],
  templateUrl: './task-form-modal.component.html',
  styleUrl: './task-form-modal.component.css',
})
export class TaskFormModalComponent implements OnChanges {
  @Input() open = false;
  @Input() assignees: User[] = [];
  @Input() isUser = false;
  @Input() allTags: Tag[] = [];
  @Input() loading = false;
  @Input() error = '';

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<CreateTaskPayload>();
  @Output() tagCreated = new EventEmitter<Tag>();

  form: FormGroup;
  selectedTags: TagLite[] = [];
  private brokenAvatarIds = new Set<string>();

  constructor(private fb: FormBuilder, public auth: AuthService) {
    this.form = this.fb.group({
      title: ['', Validators.required],
      description: [''],
      assignedTo: [''],
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.form.reset({ title: '', description: '', assignedTo: '' });
      this.selectedTags = [];
    }
  }

  onTagsChange(tags: TagLite[]) {
    this.selectedTags = tags;
  }

  onTagCreated(tag: Tag) {
    this.tagCreated.emit(tag);
  }

  get assignee(): User | null {
    const id = this.form.get('assignedTo')?.value;
    if (!id) return null;
    return this.assignees.find((u) => (u.id ?? u._id) === id) ?? null;
  }

  get assigneeLabel(): string {
    const u = this.assignee;
    return u ? `${u.username} (${u.role})` : '-- Assign to self --';
  }

  selectAssignee(user: User | null) {
    this.form.get('assignedTo')?.setValue(user ? (user.id ?? user._id ?? '') : '');
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  avatarUrl(user: User): string | null {
    const id = (user.id ?? user._id) as string;
    if (this.brokenAvatarIds.has(id)) return null;
    return this.auth.avatarUrl(user);
  }

  onAvatarError(user: User) {
    this.brokenAvatarIds.add((user.id ?? user._id) as string);
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const payload: CreateTaskPayload = { ...this.form.value, tags: this.selectedTags.map((t) => t._id) };
    if (!payload.assignedTo) delete payload.assignedTo;
    this.submitted.emit(payload);
  }
}
