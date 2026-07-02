import { Component, effect, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { ChatService } from './core/services/chat.service';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly year = new Date().getFullYear();
  private routeSub = new Subscription();

  constructor(
    public auth: AuthService,
    public chatSvc: ChatService,
    private router: Router,
    _theme: ThemeService,
  ) {
    effect(() => {
      if (auth.currentUser()) {
        chatSvc.fetchUnread();
      }
    });
  }

  ngOnInit() {
    this.routeSub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        if (this.auth.isLoggedIn()) {
          this.chatSvc.fetchUnread();
        }
      });
  }

  ngOnDestroy() {
    this.routeSub.unsubscribe();
  }
}
