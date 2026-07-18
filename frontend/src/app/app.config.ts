import { ApplicationConfig, provideZoneChangeDetection, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { catchError, firstValueFrom, of, timeout } from 'rxjs';
import { NgbTooltipConfig, NgbPopoverConfig } from '@ng-bootstrap/ng-bootstrap';
import { routes } from './app.routes';
import { tokenInterceptor } from './core/interceptors/token.interceptor';
import { AuthService } from './core/services/auth.service';

// App-wide defaults so tooltips/popovers escape scrollable cards and modals
// (the app has many overflow-clipped containers) instead of getting clipped.
function tooltipDefaults(): NgbTooltipConfig {
  const config = new NgbTooltipConfig();
  config.container = 'body';
  config.placement = 'auto';
  return config;
}

function popoverDefaults(): NgbPopoverConfig {
  const config = new NgbPopoverConfig();
  config.container = 'body';
  config.placement = 'auto';
  return config;
}

function initAuth(auth: AuthService) {
  return () => {
    if (!auth.hasLocalSession()) return Promise.resolve(null);
    return firstValueFrom(
      auth.refresh().pipe(
        timeout({ first: 5000, with: () => of(null) }),
        catchError(() => {
          // A stale/expired/invalid refresh token, or a deactivated account,
          // means there's no session to restore — clear the leftover
          // localStorage state instead of leaving it looking logged-in.
          auth.clearSessionSilent();
          return of(null);
        })
      )
    );
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([tokenInterceptor])),
    {
      provide: APP_INITIALIZER,
      useFactory: initAuth,
      deps: [AuthService],
      multi: true,
    },
    { provide: NgbTooltipConfig, useFactory: tooltipDefaults },
    { provide: NgbPopoverConfig, useFactory: popoverDefaults },
  ],
};
