import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalDirective } from '../modal.directive';
import { TagPillComponent } from '../tag-pill/tag-pill.component';

export type TagFormMode = 'create' | 'edit';

export interface TagFormPayload {
  name: string;
  textColor: string;
  backgroundColor: string;
}

@Component({
  selector: 'app-tag-form',
  standalone: true,
  imports: [FormsModule, ModalDirective, TagPillComponent],
  templateUrl: './tag-form.component.html',
  styleUrl: './tag-form.component.css',
})
export class TagFormComponent implements OnChanges {
  @Input() open = false;
  @Input() mode: TagFormMode = 'create';
  @Input() initial: TagFormPayload | null = null;
  @Input() loading = false;
  @Input() error = '';

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<TagFormPayload>();

  name = '';
  textColor = '#1f2937';
  backgroundColor = '#e5e7eb';
  localError = '';

  get displayError(): string {
    return this.localError || this.error;
  }

  get previewTag(): TagFormPayload {
    return { name: this.name.trim() || 'Preview', textColor: this.textColor, backgroundColor: this.backgroundColor };
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.name = this.initial?.name ?? '';
      this.textColor = this.initial?.textColor ?? '#1f2937';
      this.backgroundColor = this.initial?.backgroundColor ?? '#e5e7eb';
      this.localError = '';
    }
  }

  submit() {
    if (!this.name.trim()) {
      this.localError = 'Name is required';
      return;
    }
    this.localError = '';
    this.submitted.emit({
      name: this.name.trim(),
      textColor: this.textColor,
      backgroundColor: this.backgroundColor,
    });
  }
}
