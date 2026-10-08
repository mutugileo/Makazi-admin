import { defineMiddleware } from 'astro:middleware';
import { readSession } from './lib/auth/session';

// Pages anyone can open. Everything else needs a signed-in admin.
const PUBLIC_PATHS = new Set(['/login']);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;
  const user = readSession(context.cookies);
  context.locals.user = user;

  if (PUBLIC_PATHS.has(pathname)) return next();

  if (!user) {
    const target = encodeURIComponent(pathname + search);
    return context.redirect(`/login?next=${target}`, 303);
  }

  const response = await next();
  // Signed-in pages carry tenant data: never cache them in shared caches or
  // let the browser restore them from the back/forward cache after sign-out.
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
