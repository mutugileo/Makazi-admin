import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { allowAction } from '../../lib/auth/rate-limit';
import { getEntitlements, staffSeatsMessage } from '../../lib/entitlements';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const ROLES = new Set(['owner', 'manager']);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Adds a person who can sign in to this company's admin: a Supabase Auth
 * login plus a staff row (the membership). Owners only. The password is the
 * one the owner types; it is passed straight to Supabase Auth and never
 * stored or logged here.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (user.role !== 'owner') return json({ error: 'Only an owner can add users.' }, 403);
  if (!allowAction('create-staff-user', `${user.companyId}:${user.email}`)) return json({ error: 'Too many attempts to add users. Wait a minute, then try again.' }, 429);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = typeof body.role === 'string' ? body.role : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!name || name.length > 120) return json({ error: 'Enter the person\'s name.' }, 400);
    if (!EMAIL.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
    if (!ROLES.has(role)) return json({ error: 'Choose Owner or Manager.' }, 400);
    if (password.length < 12) return json({ error: 'Use a password of at least 12 characters.' }, 400);

    // Seats are checked before the login exists, so a full plan never leaves
    // an orphan login. The staff insert trigger is the hard limit.
    const entitlements = await getEntitlements(supabase, user.companyId, locals);
    const { count: staffCount, error: countErr } = await supabase
      .from('staff')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', user.companyId);
    if (countErr) throw countErr;
    if ((staffCount ?? 0) >= entitlements.staffLimit) {
      return json({ error: staffSeatsMessage(entitlements.staffLimit) }, 403);
    }

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, company_id: user.companyId, kind: 'staff' },
    });
    if (createErr || !created?.user) {
      const exists = /already|registered|exists/i.test(createErr?.message ?? '');
      return json(
        { error: exists ? 'That email already has a Makazi login. Use a different email.' : errorMessage(createErr, "Couldn't create the login. Try again.") },
        exists ? 409 : 500,
      );
    }

    const { data: staffRow, error: staffErr } = await supabase
      .from('staff')
      .insert({ company_id: user.companyId, user_id: created.user.id, name, role })
      .select('id, name, role')
      .single();
    if (staffErr || !staffRow) {
      // No login without a membership: undo the auth user. A full plan
      // (seat trigger, 22023) passes its message through.
      const { error: undoErr } = await supabase.auth.admin.deleteUser(created.user.id);
      if (undoErr) console.error('[create-staff-user] orphan login not removed:', created.user.id, undoErr.message);
      const refused = staffErr?.code === '22023';
      return json({ error: errorMessage(staffErr, "Couldn't add the user. Try again.") }, refused ? 403 : 500);
    }

    return json({ ok: true, user: { ...staffRow, email } });
  } catch (err: unknown) {
    return json({ error: errorMessage(err) }, 500);
  }
};
