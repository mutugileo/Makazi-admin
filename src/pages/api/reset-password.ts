import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
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
      isTemporary: true,
      validityHours: 72,
    });

    if (tenant.auth_user_id !== authUserId) {
      const { error: linkErr } = await supabase
        .from('tenants')
        .update({ auth_user_id: authUserId })
        .eq('company_id', user.companyId)
        .eq('id', tenant.id);
      if (linkErr) throw linkErr;
    }

    // Send in-app notification to the tenant's active tenancy
    const { data: tenancy } = await supabase
      .from('tenancies')
      .select('id')
      .eq('company_id', user.companyId)
      .eq('tenant_id', tenant.id)
      .is('move_out', null)
      .maybeSingle();

    if (tenancy) {
      const { error: notifErr } = await supabase.from('notifications').insert({
        company_id: user.companyId,
        tenancy_id: tenancy.id,
        kind: 'payment_reminder',
        title: 'Security: New 4-digit PIN generated',
        body: `Your Makazi login PIN is ${password}. Valid for 72 hours. You can change your PIN in the app under Account settings.`,
      });
      if (notifErr) console.warn('[reset-password] notification warning:', notifErr);

      await notifyTenancy(supabase, tenancy.id, 'data_updated', { action: 'notification' });
    }

    return json({ success: true, password, pin: password, phone: phone.local });
  } catch (err: unknown) {
    console.error('[reset-password]', err);
    return json({ error: errorMessage(err) }, 500);
  }
};
