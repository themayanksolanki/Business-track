import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ModalDirective } from '../modal.directive';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [ModalDirective],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.css',
})
export class ConfirmDialogComponent {
  @Input() open = false;
  @Input() title = 'Confirm Delete';
  @Input() message = 'This action cannot be undone.';
  @Input() confirmLabel = 'Delete';
  @Input() loading = false;

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
}
