import { Component, Input, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { NotificationsFeedService } from '../../core/services/notifications-feed.service';
import { AppNotification } from '../../models/notification.model';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [IconComponent, NgbDropdownModule],
  templateUrl: './notification-bell.component.html',
  styleUrl: './notification-bell.component.css',
})
export class NotificationBellComponent {
  // Mirrors the sidebar's own collapsed/expanded state — passed in rather
  // than read from SidebarService directly, so this component stays usable
  // outside the sidebar too.
  @Input() showLabel = true;

  readonly svc = inject(NotificationsFeedService);
  private readonly router = inject(Router);

  open(n: AppNotification) {
    this.svc.markAsRead(n.id);

    const link = this.svc.linkFor(n);
    if (!link) return;
    this.router.navigate(link.commands, link.queryParams ? { queryParams: link.queryParams } : {});
  }

  markAllAsRead() {
    this.svc.markAllAsRead();
  }

  timeAgo(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}
