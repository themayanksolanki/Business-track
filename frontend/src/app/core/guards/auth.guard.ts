import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Token already in memory — fast path
  if (auth.isLoggedIn()) return true;

  const toLogin = () => router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });

  // No session at all — go to login
  if (!auth.getUser()) return toLogin();

  // Token missing but user exists in localStorage (page refresh, APP_INITIALIZER race).
  // Try one more refresh before giving up.
  return auth.refresh().pipe(
    map(() => true),
    catchError(() => {
      auth.clearSessionSilent();
      return of(toLogin());
    }),
  );
};
