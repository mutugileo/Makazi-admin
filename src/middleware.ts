import { defineMiddleware } from 'astro:middleware';
import { readSession } from './lib/auth/session';
import { makeSupabaseClient } from './lib/supabase';
import { getEntitlements, READ_ONLY_MESSAGE } from './lib/entitlements';

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

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// API routes that change nothing a suspension covers: the assistant only
// reads, typing is a realtime ping, mark-read stamps messages as seen.
const READ_ONLY_ALLOWED = new Set(['/api/assistant', '/api/typing', '/api/mark-read']);

const jsonError = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });

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

  // Suspended or cancelled: refuse landlord writes with a clear message. The
  // database refuses them too; this says why. Read fresh on every request.
  const apiPath = pathname.replace(/\/+$/, '');
  if (apiPath.startsWith('/api/') && WRITE_METHODS.has(context.request.method) && !READ_ONLY_ALLOWED.has(apiPath)) {
    const supabase = makeSupabaseClient(context.cookies);
    if (supabase) {
      try {
        const entitlements = await getEntitlements(supabase, user.companyId, context.locals);
        if (entitlements.readOnly) {
          const refused = jsonError(READ_ONLY_MESSAGE, 403);
          securityHeaders(refused);
          return refused;
        }
      } catch (err) {
        console.error('[middleware] entitlements check failed:', err);
        const failed = jsonError("Couldn't check your Makazi account. Try again.", 503);
        securityHeaders(failed);
        return failed;
      }
    }
  }

  const response = await next();
  // Signed-in pages carry tenant data: never cache them in shared caches or
  // let the browser restore them from the back/forward cache after sign-out.
  response.headers.set('Cache-Control', 'no-store');
  securityHeaders(response);
  return response;
});
