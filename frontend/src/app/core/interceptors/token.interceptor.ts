import { HttpInterceptorFn, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { AuthResponse } from '../../models/user.model';
import { environment } from '../../../environments/environment';

function addToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return req.clone({
    withCredentials: true,
    ...(token ? { setHeaders: { Authorization: `Bearer ${token}` } } : {}),
  });
}

export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  if (req.url.includes('/uploads/')) return next(req);

  // Presigned S3 URLs / direct Cloudinary URLs are external — they must never
  // get our cookies or Authorization header, both because it's unnecessary
  // and because neither provider supports Access-Control-Allow-Credentials
  // for our origin, so a credentialed cross-origin request to them would
  // just fail CORS outright.
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  return next(addToken(req, auth.getToken())).pipe(
    catchError((err: HttpErrorResponse) => {
      const isRefresh = req.url.includes('/auth/refresh');
      const isLogin = req.url.includes('/auth/login');

      // Only skip the auto-refresh-and-retry dance when the failing request
      // IS the refresh (or login) call itself — retrying those would loop.
      if (err.status === 401 && !isRefresh && !isLogin) {
        return auth.refresh().pipe(
          switchMap((res: AuthResponse) => next(addToken(req, res.token))),
          catchError((refreshErr) => {
            auth.clearSession();
            return throwError(() => refreshErr);
          })
        );
      }

      // The backend only ever uses 403 for "you may not do this" — never for
      // bad/expired tokens (that's always 401) — so it's always a signal to
      // drop the session, including a 403 from /auth/refresh itself (e.g. the
      // account was deactivated). The one exception is a failed login
      // attempt: there's no session to clear, and clearing would redirect
      // the user away from the login page they're already on.
      if (err.status === 403 && !isLogin) {
        auth.clearSession();
      }

      return throwError(() => err);
    })
  );
};
