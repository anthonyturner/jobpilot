import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ApiService } from './api.service';

let complete = false;

/** Mark setup done so the guard stops asking the server. */
export function markSetupComplete(): void {
  complete = true;
}

/** Sends a fresh install to the setup wizard until the user finishes it. */
export const setupGuard: CanActivateFn = () => {
  if (complete) return true;
  const router = inject(Router);
  return inject(ApiService)
    .setupStatus()
    .pipe(
      map((status) => {
        complete = status.complete;
        return status.complete ? true : router.createUrlTree(['/setup']);
      }),
      // If the API is unreachable, let the page load and show its own error state.
      catchError(() => of(true)),
    );
};
