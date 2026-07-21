import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AppNotification } from '../../models/notification.model';
import { SKIP_LOADER } from '../interceptors/loading.interceptor';

export interface NotificationLink {
  commands: any[];
  queryParams?: Record<string, any>;
}

@Injectable({ providedIn: 'root' })
export class NotificationsFeedService {
  private readonly api = `${environment.apiUrl}/notifications`;

  private readonly _notifications = signal<AppNotification[]>([]);
  readonly notifications = this._notifications.asReadonly();
  readonly unreadCount = signal(0);

  private readonly skipLoaderContext = new HttpContext().set(SKIP_LOADER, true);

  constructor(private http: HttpClient) {}

  fetchRecent() {
    this.http
      .get<{ notifications: AppNotification[]; unreadCount: number }>(this.api, {
        context: this.skipLoaderContext,
      })
      .subscribe({
        next: (res) => {
          this._notifications.set(res.notifications);
          this.unreadCount.set(res.unreadCount);
        },
        error: () => {},
      });
  }

  // Called from the socket subscription when a live 'notification:new' event
  // arrives — the DB fetch above stays the source of truth on refresh/login,
  // this just keeps the open session's list current without a re-fetch.
  handleIncoming(notification: AppNotification) {
    this._notifications.update((list) => [notification, ...list]);
    this.unreadCount.update((count) => count + 1);
  }

  markAsRead(id: number) {
    const target = this._notifications().find((n) => n.id === id);
    if (!target || target.isRead) return;

    this._notifications.update((list) => list.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    this.unreadCount.update((count) => Math.max(0, count - 1));

    this.http.patch(`${this.api}/${id}/read`, {}).subscribe({ error: () => {} });
  }

  markAllAsRead() {
    this._notifications.update((list) => list.map((n) => ({ ...n, isRead: true })));
    this.unreadCount.set(0);

    this.http.patch(`${this.api}/read-all`, {}).subscribe({ error: () => {} });
  }

  linkFor(n: AppNotification): NotificationLink | null {
    if (n.projectItemId && n.projectId) {
      return {
        commands: ['/projects', n.projectId],
        queryParams: { tab: 'tasks', item: n.projectItemId, comment: n.commentId ?? null },
      };
    }
    if (n.taskId) {
      return { commands: ['/tasks', n.taskId, 'edit'] };
    }
    if (n.projectId) {
      return {
        commands: ['/projects', n.projectId],
        queryParams: n.type === 'projectMemberAdded' ? { tab: 'teams' } : undefined,
      };
    }
    return null;
  }
}
