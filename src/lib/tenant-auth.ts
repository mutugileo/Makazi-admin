// Tenant logins (shared/AUTH.md): phone + password, issued by the manager.
//
// A tenant's Supabase Auth user is <254XXXXXXXXX>@tenant.makazi.app. Every
// password the manager issues is one-time: mark_password_pending() hides all
// data from that user until the app has set their own password and called
// complete_password_change(). user_metadata.is_temporary is only a UI hint,
// since users can edit their own metadata.

import type { SupabaseClient } from '@supabase/supabase-js';
import { UserFacingError } from './errors';

export interface KenyanPhone {
  /** 254712345678 */
  digits: string;
  /** 0712345678, the form tenants.phone stores. */
  local: string;
  /** +254712345678 */
  intl: string;
  authEmail: string;
}

/** Safaricom / Airtel numbers in any common form, else null. */
export function parseKenyanPhone(raw: unknown): KenyanPhone | null {
  // Digits with the usual separators only; anything else is not a phone number.
  if (typeof raw !== 'string' || !/^[\d\s+()-]{9,20}$/.test(raw.trim())) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) d = `254${d.slice(1)}`;
  else if (d.length === 9) d = `254${d}`;
  if (!/^254[17]\d{8}$/.test(d)) return null;
  return { digits: d, local: `0${d.slice(3)}`, intl: `+${d}`, authEmail: `${d}@tenant.makazi.app` };
}

/** Every stored spelling of the number, for lookups on tenants.phone. */
export function phoneSpellings(p: KenyanPhone): string[] {
  return [p.local, p.intl, p.digits];
}

export function pinToSupabasePassword(pin: string): string {
  const trimmed = pin.trim();
  return trimmed.length === 4 ? `makazi-pin-${trimmed}` : trimmed;
}

export function generateFourDigitPin(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (1000 + (buf[0] % 9000)).toString();
}

export function generateOneTimePassword(): string {
  return generateFourDigitPin();
}

/** Looks through every page of auth users (listUsers returns 50 by default). */
async function findAuthUserIdByEmail(supabase: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
}

/**
 * Every tenant login (auth email -> user id), read once. Batch jobs use this
 * instead of paging through all auth users for every row.
 */
export async function tenantAuthUserIds(supabase: SupabaseClient): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) {
      const email = u.email?.toLowerCase();
      if (email?.endsWith('@tenant.makazi.app')) ids.set(email, u.id);
    }
    if (data.users.length < 1000) return ids;
  }
}

/**
 * One phone has one Makazi login across every landlord. Resetting it from a
 * company that doesn't hold it would hand that company the other landlord's
 * tenant account, so the login must be linked to a tenant of this company
 * (or, when it has no tenant row yet, have been created for this company).
 */
async function assertLoginBelongsToCompany(supabase: SupabaseClient, userId: string, companyId: string) {
  const { data: rows, error } = await supabase.from('tenants').select('company_id').eq('auth_user_id', userId);
  if (error) throw error;
  if (rows && rows.length > 0) {
    if (rows.some((r) => r.company_id === companyId)) return;
    throw new UserFacingError('This phone number already has a Makazi login with another landlord. Ask the tenant to use a different number.');
  }
  const { data: found, error: userErr } = await supabase.auth.admin.getUserById(userId);
  if (userErr) throw userErr;
  const owner = found?.user?.user_metadata?.company_id;
  if (owner && owner !== companyId) {
    throw new UserFacingError('This phone number already has a Makazi login with another landlord. Ask the tenant to use a different number.');
  }
}

/**
 * Creates the tenant's login, or resets it, with a 4-digit PIN.
 * Returns the auth user id.
 */
export async function issueOneTimePassword(
  supabase: SupabaseClient,
  opts: {
    phone: KenyanPhone;
    password: string;
    name: string;
    companyId: string;
    knownUserId?: string | null;
    /** The caller already looked the login up and found none: skip the lookup. */
    knownAbsent?: boolean;
    isTemporary?: boolean;
    validityHours?: number;
  },
): Promise<string> {
  const isTemporary = opts.isTemporary ?? true;
  const validityHours = opts.validityHours ?? 72;
  const expiresAt = new Date(Date.now() + validityHours * 3600 * 1000).toISOString();

  const metadata = {
    name: opts.name,
    phone: opts.phone.intl,
    company_id: opts.companyId,
    is_temporary: isTemporary,
    pin_expires_at: isTemporary ? expiresAt : null,
  };
  let userId =
    opts.knownUserId ?? (opts.knownAbsent ? null : await findAuthUserIdByEmail(supabase, opts.phone.authEmail));
  const supabasePassword = pinToSupabasePassword(opts.password);

  if (userId) {
    await assertLoginBelongsToCompany(supabase, userId, opts.companyId);
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password: supabasePassword,
      user_metadata: metadata,
    });
    if (error) throw error;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: opts.phone.authEmail,
      password: supabasePassword,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error) throw error;
    userId = data.user.id;
  }

  return userId;
}
