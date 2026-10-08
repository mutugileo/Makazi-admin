// Signed session cookie for the admin. The cookie holds who is signed in,
// their role, company, and expiration timestamp, signed with HMAC-SHA256.
// HttpOnly (no page script can read it) and SameSite=Lax.

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
  companyId: string;
  role: 'owner';
  exp: number; // unix seconds
}

/** True once `npm run admin:create` has written the admin to .env or SESSION_SECRET is set. */
export function adminConfigured(): boolean {
  return Boolean(SESSION_SECRET && (ADMIN_EMAIL || process.env.ADMIN_EMAIL));
}

export function adminAccount(): { email: string; name: string; passwordHash: string; companyId: string } | null {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) return null;
  return {
    email: ADMIN_EMAIL.toLowerCase(),
    name: ADMIN_NAME || 'Admin',
    passwordHash: ADMIN_PASSWORD_HASH,
    companyId: ADMIN_COMPANY_ID ?? 'harborridge',
  };
}

function sign(body: string): string {
  const secret = SESSION_SECRET || process.env.SESSION_SECRET || 'makazi_session_secret_default_key_2026';
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function createSession(
  cookies: AstroCookies,
  user: { email: string; name: string; companyId?: string; role?: 'owner' },
  secure: boolean
) {
  const account = adminAccount();
  const companyId = user.companyId || account?.companyId || 'harborridge';
  const payload: SessionPayload = {
    sub: user.email.toLowerCase(),
    name: user.name,
    companyId,
    role: user.role || 'owner',
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
  const raw = cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const [body, signature] = raw.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    const account = adminAccount();
    return {
      email: payload.sub,
      name: payload.name || account?.name || 'Admin',
      role: 'owner',
      companyId: payload.companyId || account?.companyId || 'harborridge',
    };
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
