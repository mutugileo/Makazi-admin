import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
import { parseKenyanPhone, phoneSpellings } from '../../lib/tenant-auth';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Sends a just-issued login PIN to the tenant's app as a notification. The
 * text is built here from the tenant's own record (company name, phone), the
 * same words the admin sees, so the client can't send anything else.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = await request.json();
    const phone = parseKenyanPhone(body?.phone);
    const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';
    if (!phone) return json({ error: 'Enter a valid Safaricom or Airtel number' }, 400);
    if (!/^\d{4}$/.test(pin)) return json({ error: 'The PIN must be 4 digits.' }, 400);

    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id')
      .eq('company_id', user.companyId)
      .in('phone', phoneSpellings(phone))
      .maybeSingle();
    if (tenantErr) throw tenantErr;
    if (!tenant) return json({ error: 'No tenant with that number in your company' }, 404);

    const { data: tenancy, error: tenancyErr } = await supabase
      .from('tenancies')
      .select('id')
      .eq('company_id', user.companyId)
      .eq('tenant_id', tenant.id)
      .is('move_out', null)
      .maybeSingle();
    if (tenancyErr) throw tenancyErr;
    if (!tenancy) return json({ error: 'This tenant has no current tenancy, so there is no app to send to.' }, 409);

    const { data: company } = await supabase.from('companies').select('name').eq('id', user.companyId).maybeSingle();
    const message =
      `${company?.name || 'Makazi'}: your Makazi login PIN is ${pin}. ` +
      `Sign in with ${phone.local} on the Makazi app using this 4-digit PIN.`;

    const { error: notifErr } = await supabase.from('notifications').insert({
      company_id: user.companyId,
      tenancy_id: tenancy.id,
      kind: 'pin_reset',
      title: 'Your Makazi login PIN',
      body: message,
    });
    if (notifErr) throw notifErr;

    await notifyTenancy(supabase, tenancy.id, 'data_updated', { action: 'notification' });
    return json({ ok: true });
  } catch (err: unknown) {
    return json({ error: errorMessage(err, "Couldn't send to the app. Try again.") }, 500);
  }
};
