import { HttpInterceptorFn, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { AuthResponse } from '../../models/user.model';

function addToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return req.clone({
    withCredentials: true,
    ...(token ? { setHeaders: { Authorization: `Bearer ${token}` } } : {}),
  });
}

export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  return next(addToken(req, auth.getToken())).pipe(
    catchError((err: HttpErrorResponse) => {
      const isRefreshOrLogin = req.url.includes('/auth/refresh') || req.url.includes('/auth/login');

      if (err.status === 401 && !isRefreshOrLogin) {
        return auth.refresh().pipe(
          switchMap((res: AuthResponse) => next(addToken(req, res.token))),
          catchError((refreshErr) => {
            auth.clearSession();
            return throwError(() => refreshErr);
          })
        );
      }

      if (err.status === 403 && !isRefreshOrLogin) {
        auth.clearSession();
      }

      return throwError(() => err);
    })
  );
};
