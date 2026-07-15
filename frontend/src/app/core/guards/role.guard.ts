import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

export const roleGuard: CanActivateFn = (route) => {
  const user = inject(AuthService).getUser();
  const router = inject(Router);
  const allowedRoles: string[] = route.data['roles'] ?? [];

  if (user && allowedRoles.includes(user.role)) return true;

  return router.createUrlTree(['/dashboard']);
};
