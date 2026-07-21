import { Component, effect, inject, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { ChatService } from './core/services/chat.service';
import { ThemeService } from './core/services/theme.service';
import { SidebarService } from './core/services/sidebar.service';
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

  constructor(
    public auth: AuthService,
    public chatSvc: ChatService,
    private router: Router,
    _theme: ThemeService,
  ) {
    effect(() => {
      // if (auth.currentUser()) {
      //   chatSvc.fetchUnread();
      // }
    });
  }

  ngOnInit() {
    this.routeSub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        // if (this.auth.isLoggedIn()) {
        //   this.chatSvc.fetchUnread();
        // }
      });
  }

  ngOnDestroy() {
    this.routeSub.unsubscribe();
  }
}
