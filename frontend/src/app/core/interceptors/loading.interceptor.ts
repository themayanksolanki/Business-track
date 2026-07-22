import { HttpContextToken, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { LoadingService } from '../services/loading.service';

// The global loader overlay is reserved for page navigation and the
// login/logout auth calls (wired up in app.component.ts and auth.service.ts)
// — regular API calls (saves, fetches, background polling) skip it by
// default so they don't flash the overlay on every request. Set this on a
// request's context to opt a specific call into the overlay.
export const SHOW_LOADER = new HttpContextToken<boolean>(() => false);

export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.context.get(SHOW_LOADER)) return next(req);

  const loading = inject(LoadingService);
  loading.start();
  return next(req).pipe(finalize(() => loading.stop()));
};
