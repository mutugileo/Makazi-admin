import { defineMiddleware } from 'astro:middleware';
import { readSession } from './lib/auth/session';

// Pages and probe endpoints anyone can open. Everything else needs a signed-in admin.
const PUBLIC_PATHS = new Set(['/login', '/api/health']);

// Origins the pages actually load from: Google Fonts (CSS + font files) and
// Supabase (REST, storage photos, realtime on messages). Astro's ClientRouter
// and the pages use inline scripts and styles, hence 'unsafe-inline'.
// Property photos are any https image URL the landlord pastes.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function securityHeaders(response: Response) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if ((response.headers.get('Content-Type') ?? '').includes('text/html')) {
    response.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;
  const user = readSession(context.cookies);
  context.locals.user = user;

  if (PUBLIC_PATHS.has(pathname)) {
    const response = await next();
    securityHeaders(response);
    return response;
  }

  if (!user) {
    const target = encodeURIComponent(pathname + search);
    return context.redirect(`/login?next=${target}`, 303);
  }

  const response = await next();
  // Signed-in pages carry tenant data: never cache them in shared caches or
  // let the browser restore them from the back/forward cache after sign-out.
  response.headers.set('Cache-Control', 'no-store');
  securityHeaders(response);
  return response;
});
