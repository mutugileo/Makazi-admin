// Signed session cookie for the local admin. The cookie holds who is signed in
// and when it expires, signed with HMAC-SHA256 so it can't be edited. It is
// HttpOnly (no page script can read it) and SameSite=Lax.
//
// Phase 2 replaces this file with Supabase Auth sessions (@supabase/ssr).

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { ADMIN_COMPANY_ID, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD_HASH, SESSION_SECRET } from 'astro:env/server';

export const SESSION_COOKIE = 'makazi_admin_session';
export const SESSION_HOURS = 12;

export interface AdminUser {
  email: string;
  name: string;
  role: 'owner';
  /** Every page shows this company's data only. */
  companyId: string;
}

interface SessionPayload {
  sub: string;
  name: string;
  exp: number; // unix seconds
}

/** True once `npm run admin:create` has written the admin to .env. */
export function adminConfigured(): boolean {
  return Boolean(ADMIN_EMAIL && ADMIN_PASSWORD_HASH && SESSION_SECRET);
}

export function adminAccount(): { email: string; name: string; passwordHash: string; companyId: string } | null {
  if (!adminConfigured()) return null;
  return {
    email: ADMIN_EMAIL!.toLowerCase(),
    name: ADMIN_NAME || 'Admin',
    passwordHash: ADMIN_PASSWORD_HASH!,
    companyId: ADMIN_COMPANY_ID ?? 'harborridge',
  };
}

function sign(body: string): string {
  return createHmac('sha256', SESSION_SECRET!).update(body).digest('base64url');
}

export function createSession(cookies: AstroCookies, user: { email: string; name: string }, secure: boolean) {
  const payload: SessionPayload = {
    sub: user.email,
    name: user.name,
    exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  cookies.set(SESSION_COOKIE, `${body}.${sign(body)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
}

export function readSession(cookies: AstroCookies): AdminUser | null {
  const account = adminAccount();
  const raw = cookies.get(SESSION_COOKIE)?.value;
  if (!account || !raw) return null;

  const [body, signature] = raw.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
    // Expired, or the admin was replaced since this cookie was issued.
    if (payload.exp * 1000 < Date.now() || payload.sub !== account.email) return null;
    // The company itself is checked where its data is loaded: an unknown id
    // fails there (seed or Supabase) instead of falling back to demo data.
    return { email: payload.sub, name: account.name, role: 'owner', companyId: account.companyId };
  } catch {
    return null;
  }
}

export function clearSession(cookies: AstroCookies) {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Only allow redirects back into this site (no open redirects). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
