// Tenant logins (shared/AUTH.md): phone + password, issued by the manager.
//
// A tenant's Supabase Auth user is <254XXXXXXXXX>@tenant.makazi.app. Every
// password the manager issues is one-time: mark_password_pending() hides all
// data from that user until the app has set their own password and called
// complete_password_change(). user_metadata.is_temporary is only a UI hint,
// since users can edit their own metadata.

import type { SupabaseClient } from '@supabase/supabase-js';

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

export function generateOneTimePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  // 31 letters: reject bytes past the last full multiple so each is equally likely.
  const chars: string[] = [];
  while (chars.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && chars.length < 12) chars.push(alphabet[b % alphabet.length]);
    }
  }
  const s = chars.join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
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
 * Creates the tenant's login, or resets it, with a one-time password, and
 * locks their data until they choose their own. Returns the auth user id.
 */
export async function issueOneTimePassword(
  supabase: SupabaseClient,
  opts: { phone: KenyanPhone; password: string; name: string; companyId: string; knownUserId?: string | null },
): Promise<string> {
  const metadata = { name: opts.name, phone: opts.phone.intl, company_id: opts.companyId, is_temporary: true };
  let userId = opts.knownUserId ?? (await findAuthUserIdByEmail(supabase, opts.phone.authEmail));

  if (userId) {
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password: opts.password,
      user_metadata: metadata,
    });
    if (error) throw error;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: opts.phone.authEmail,
      password: opts.password,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error) throw error;
    userId = data.user.id;
  }

  const { error: pendingErr } = await supabase.rpc('mark_password_pending', { p_user: userId, p_hours: 72 });
  if (pendingErr) throw pendingErr;
  return userId;
}
