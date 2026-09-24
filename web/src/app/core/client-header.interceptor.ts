import { HttpInterceptorFn } from '@angular/common/http';

/**
 * The API refuses browser writes without this header. A custom header forces a CORS
 * preflight, which the API never approves for other origins, so other websites
 * cannot trigger writes against your local server (CSRF).
 */
export const clientHeaderInterceptor: HttpInterceptorFn = (req, next) =>
  req.url.startsWith('/api/') ? next(req.clone({ setHeaders: { 'x-jobpilot-client': 'web' } })) : next(req);
