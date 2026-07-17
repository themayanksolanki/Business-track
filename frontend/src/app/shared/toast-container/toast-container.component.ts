import { Component, inject } from '@angular/core';
import { NotificationService } from '../notification.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  templateUrl: './toast-container.component.html',
  styleUrl: './toast-container.component.css',
})
export class ToastContainerComponent {
  readonly notifications = inject(NotificationService);
}
