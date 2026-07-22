import { Component, effect, inject, OnInit, OnDestroy } from '@angular/core';
import {
  RouterOutlet,
  Router,
  NavigationStart,
  NavigationEnd,
  NavigationCancel,
  NavigationError,
  NavigationSkipped,
} from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { ChatService } from './core/services/chat.service';
import { ThemeService } from './core/services/theme.service';
import { SidebarService } from './core/services/sidebar.service';
import { SocketService } from './core/services/socket.service';
import { NotificationsFeedService } from './core/services/notifications-feed.service';
import { NotificationService } from './shared/notification.service';
import { LoadingService } from './core/services/loading.service';
import { SidebarComponent } from './shared/sidebar/sidebar.component';
import { ToastContainerComponent } from './shared/toast-container/toast-container.component';
import { GlobalLoaderComponent } from './shared/global-loader/global-loader.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, ToastContainerComponent, GlobalLoaderComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly year = new Date().getFullYear();
  readonly sidebarSvc = inject(SidebarService);
  private routeSub = new Subscription();
  private socketSub = new Subscription();

  constructor(
    public auth: AuthService,
    public chatSvc: ChatService,
    private socketSvc: SocketService,
    private notificationsFeedSvc: NotificationsFeedService,
    private toastSvc: NotificationService,
    private router: Router,
    private loadingSvc: LoadingService,
    _theme: ThemeService,
  ) {
    // Owns the socket connection app-wide (previously only ChatComponent
    // connected/disconnected it, which meant a bell fed by the same socket
    // would go dark the moment the user left the Chat page).
    effect(() => {
      const user = auth.currentUser();
      const token = auth.getToken();
      if (user && token) {
//         chatSvc.fetchUnread();
        notificationsFeedSvc.fetchRecent();
        socketSvc.connect(token);
      } else {
        socketSvc.disconnect();
      }
    });

    this.socketSub.add(
      this.socketSvc.notification$.subscribe((n) => {
        notificationsFeedSvc.handleIncoming(n);
        toastSvc.success(n.message);
      }),
    );
    this.socketSub.add(
      this.socketSvc.reconnected$.subscribe(() => {
        if (this.auth.isLoggedIn()) this.notificationsFeedSvc.fetchRecent();
      }),
    );
  }

  ngOnInit() {
    // Best-effort — fired once on app bootstrap (not just the login page) so
    // a returning user with a still-valid session also gives a sleeping
    // free-tier DB (e.g. Supabase auto-pause) a head start waking up, before
    // the first real API call needs it. Must never block or surface an error.
    this.auth.warmDb().subscribe({ error: () => {} });

    this.routeSub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.loadingSvc.start();
        return;
      }
      if (
        e instanceof NavigationEnd ||
        e instanceof NavigationCancel ||
        e instanceof NavigationError ||
        e instanceof NavigationSkipped
      ) {
        this.loadingSvc.stop();
      }
      if (e instanceof NavigationEnd && this.auth.isLoggedIn()) {
//         this.chatSvc.fetchUnread();
        this.notificationsFeedSvc.fetchRecent();
      }
    });
  }

  ngOnDestroy() {
    this.routeSub.unsubscribe();
    this.socketSub.unsubscribe();
  }
}
