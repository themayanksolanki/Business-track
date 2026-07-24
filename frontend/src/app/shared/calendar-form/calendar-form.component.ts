import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalDirective } from '../modal.directive';

export type CalendarFormMode = 'create' | 'edit';

export interface CalendarFormPayload {
  name: string;
  color: string;
}

@Component({
  selector: 'app-calendar-form',
  standalone: true,
  imports: [FormsModule, ModalDirective],
  templateUrl: './calendar-form.component.html',
  styleUrl: './calendar-form.component.css',
})
export class CalendarFormComponent implements OnChanges {
  @Input() open = false;
  @Input() mode: CalendarFormMode = 'create';
  @Input() initial: CalendarFormPayload | null = null;
  @Input() loading = false;
  @Input() error = '';

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<CalendarFormPayload>();

  name = '';
  color = '#3b82f6';
  localError = '';

  get displayError(): string {
    return this.localError || this.error;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.name = this.initial?.name ?? '';
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
    this.submitted.emit({ name: this.name.trim(), color: this.color });
  }
}
