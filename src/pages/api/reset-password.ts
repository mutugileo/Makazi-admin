import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { generateOneTimePassword, issueOneTimePassword, parseKenyanPhone, phoneSpellings } from '../../lib/tenant-auth';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Manager-issued password reset (never self-service). Only for a tenant of the
// signed-in admin's own company; the new password is one-time.
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = await request.json();
    const phone = parseKenyanPhone(body?.phone);
    if (!phone) return json({ error: 'Enter a valid Safaricom or Airtel number' }, 400);

    const { data: tenant, error: findErr } = await supabase
      .from('tenants')
      .select('id, name, auth_user_id')
      .eq('company_id', user.companyId)
      .in('phone', phoneSpellings(phone))
      .maybeSingle();
    if (findErr) throw findErr;
    if (!tenant) return json({ error: 'No tenant with that number in your company' }, 404);

    const password = generateOneTimePassword();
    const authUserId = await issueOneTimePassword(supabase, {
      phone,
      password,
      name: tenant.name,
      companyId: user.companyId,
      knownUserId: tenant.auth_user_id,
    });

    if (tenant.auth_user_id !== authUserId) {
      const { error: linkErr } = await supabase
        .from('tenants')
        .update({ auth_user_id: authUserId })
        .eq('company_id', user.companyId)
        .eq('id', tenant.id);
      if (linkErr) throw linkErr;
    }

    return json({ success: true, password, phone: phone.local });
  } catch (err: unknown) {
    console.error('[reset-password]', err);
    return json({ error: errorMessage(err) }, 500);
  }
};
