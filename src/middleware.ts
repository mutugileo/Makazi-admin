import { defineMiddleware } from 'astro:middleware';
import { readSession } from './lib/auth/session';

// Pages and probe endpoints anyone can open. Everything else needs a signed-in admin.
const PUBLIC_PATHS = new Set(['/login', '/api/health']);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;
  const user = readSession(context.cookies);
  context.locals.user = user;

  if (PUBLIC_PATHS.has(pathname)) {
    const response = await next();
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
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
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
});
