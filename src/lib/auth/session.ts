// Signed session cookie for the admin. The cookie holds who is signed in,
// their role, company, and expiration timestamp, signed with HMAC-SHA256.
// HttpOnly (no page script can read it) and SameSite=Lax.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { ADMIN_COMPANY_ID, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD_HASH, SESSION_SECRET } from 'astro:env/server';

export const SESSION_COOKIE = 'makazi_admin_session';
export const SESSION_HOURS = 12;

export type StaffRole = 'owner' | 'manager' | 'caretaker';
const VALID_ROLES = new Set<StaffRole>(['owner', 'manager', 'caretaker']);

export interface AdminUser {
  email: string;
  name: string;
  role: StaffRole;
  /** Every page shows this company's data only. */
  companyId: string;
  /** staff.id of the signed-in person; absent in sessions started before it was stored. */
  staffId?: string;
}

interface SessionPayload {
  sub: string;
  name: string;
  companyId: string;
  role: StaffRole;
  staffId?: string;
  exp: number; // unix seconds
}

import { supabaseConfigured } from '../supabase';

/** True once Supabase is configured or `npm run admin:create` has written the admin to .env or SESSION_SECRET is set. */
export function adminConfigured(): boolean {
  return supabaseConfigured() || Boolean(SESSION_SECRET && (ADMIN_EMAIL || process.env.ADMIN_EMAIL));
}

/** The env-configured admin (offline development only). */
export function adminAccount(): { email: string; name: string; passwordHash: string; companyId: string } | null {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH || !ADMIN_COMPANY_ID) return null;
  return {
    email: ADMIN_EMAIL.toLowerCase(),
    name: ADMIN_NAME || 'Admin',
    passwordHash: ADMIN_PASSWORD_HASH,
    companyId: ADMIN_COMPANY_ID,
  };
}

/** Fails closed: without a secret nothing can be signed or verified. */
function sign(body: string): string {
  const secret = SESSION_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function createSession(
  cookies: AstroCookies,
  user: { email: string; name: string; companyId?: string; role?: StaffRole; staffId?: string },
  secure: boolean
) {
  const companyId = user.companyId || adminAccount()?.companyId;
  if (!companyId) throw new Error('Cannot start an admin session without a company');
  const payload: SessionPayload = {
    sub: user.email.toLowerCase(),
    name: user.name,
    companyId,
    role: user.role && VALID_ROLES.has(user.role) ? user.role : 'manager',
    ...(user.staffId ? { staffId: user.staffId } : {}),
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
    // A session without a company or valid role is not a session.
    if (!payload.companyId || !VALID_ROLES.has(payload.role)) return null;
    return {
      email: payload.sub,
      name: payload.name || 'Admin',
      role: payload.role,
      companyId: payload.companyId,
      ...(typeof payload.staffId === 'string' && payload.staffId ? { staffId: payload.staffId } : {}),
    };
  } catch {
    return null;
  }
}

export function clearSession(cookies: AstroCookies) {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/**
 * Only allow redirects back into this site (no open redirects). Browsers
 * strip tabs/newlines and read '\\' as '/', so '/%09/evil' or '/\\evil' can
 * become '//evil'; anything with control characters, backslashes or a
 * different origin goes to '/'.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  let decoded = next;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return '/';
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F\\]/.test(next) || /[\u0000-\u001F\u007F\\]/.test(decoded) || decoded.startsWith('//')) return '/';
  try {
    const base = 'http://x';
    const url = new URL(next, base);
    if (url.origin !== base) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
