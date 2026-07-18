import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalDirective } from '../modal.directive';

export type DepartmentFormMode = 'create' | 'edit';

export interface DepartmentFormPayload {
  name: string;
  overview: string;
  color: string;
}

@Component({
  selector: 'app-department-form',
  standalone: true,
  imports: [FormsModule, ModalDirective],
  templateUrl: './department-form.component.html',
  styleUrl: './department-form.component.css',
})
export class DepartmentFormComponent implements OnChanges {
  @Input() open = false;
  @Input() mode: DepartmentFormMode = 'create';
  @Input() parentName: string | null = null;
  @Input() initial: DepartmentFormPayload | null = null;
  @Input() loading = false;
  @Input() error = '';

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<DepartmentFormPayload>();

  name = '';
  overview = '';
  color = '#3b82f6';
  localError = '';

  get displayError(): string {
    return this.localError || this.error;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.name = this.initial?.name ?? '';
      this.overview = this.initial?.overview ?? '';
      this.color = this.initial?.color ?? '#3b82f6';
      this.localError = '';
    }
  }

  submit() {
    if (!this.name.trim()) {
      this.localError = 'Name is required';
      return;
    }
    this.localError = '';
    this.submitted.emit({ name: this.name.trim(), overview: this.overview, color: this.color });
  }
}
