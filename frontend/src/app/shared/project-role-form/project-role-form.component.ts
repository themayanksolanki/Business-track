import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalDirective } from '../modal.directive';

export type ProjectRoleFormMode = 'create' | 'edit';

export interface ProjectRoleFormPayload {
  title: string;
  description: string;
}

@Component({
  selector: 'app-project-role-form',
  standalone: true,
  imports: [FormsModule, ModalDirective],
  templateUrl: './project-role-form.component.html',
  styleUrl: './project-role-form.component.css',
})
export class ProjectRoleFormComponent implements OnChanges {
  @Input() open = false;
  @Input() mode: ProjectRoleFormMode = 'create';
  @Input() initial: ProjectRoleFormPayload | null = null;
  // Default roles (Owner/Editor/Viewer) can't be renamed — title becomes read-only.
  @Input() titleLocked = false;
  @Input() loading = false;
  @Input() error = '';

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<ProjectRoleFormPayload>();

  title = '';
  description = '';
  localError = '';

  get displayError(): string {
    return this.localError || this.error;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.title = this.initial?.title ?? '';
      this.description = this.initial?.description ?? '';
      this.localError = '';
    }
  }

  submit() {
    if (!this.title.trim()) {
      this.localError = 'Title is required';
      return;
    }
    this.localError = '';
    this.submitted.emit({ title: this.title.trim(), description: this.description });
  }
}
