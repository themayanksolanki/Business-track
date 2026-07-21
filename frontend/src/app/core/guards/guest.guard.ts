import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const guestGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.isLoggedIn()) return true;

  // Already logged in but landed on /login anyway (e.g. a shared-link
  // returnUrl in a stale tab) — honor it instead of always bouncing to Chat.
  // parseUrl (not createUrlTree([returnUrl])) so an embedded query string in
  // returnUrl is interpreted correctly rather than being treated as a
  // literal path segment.
  const returnUrl = route.queryParamMap.get('returnUrl');
  return returnUrl ? router.parseUrl(returnUrl) : router.createUrlTree(['/chat']);
};
