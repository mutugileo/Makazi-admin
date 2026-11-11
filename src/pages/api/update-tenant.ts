import type { APIRoute } from 'astro';
import { makeSupabaseClient } from '../../lib/supabase';
import { clearLiveCache } from '../../data/portfolio';
import { notifyTenancy, notifyCompany } from '../../lib/realtime';
import { parseKenyanPhone } from '../../lib/tenant-auth';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = await request.json();
    const { tenancyId, tenantId, name, phone: rawPhone, email, rent, deposit, moveIn, moveInRent, leaseEnd } = body;

    if (!tenancyId || !tenantId || !name || !rawPhone || !rent) {
      return json({ error: 'Missing required tenant or tenancy fields.' }, 400);
    }

    const companyId = user.companyId;

    // Validate phone
    const parsedPhone = parseKenyanPhone(rawPhone);
    if (!parsedPhone) {
      return json({ error: 'Enter a valid Kenyan mobile number (07... or 01...).' }, 400);
    }

    const rentKes = Math.round(Number(rent));
    const depositKes = deposit !== undefined && deposit !== null && deposit !== '' ? Math.round(Number(deposit)) : undefined;
    if (rentKes <= 0) {
      return json({ error: 'Monthly rent must be greater than zero.' }, 400);
    }
    const moveInRentKes = moveInRent === '' || moveInRent == null ? NaN : Math.round(Number(moveInRent));
    if (!(moveInRentKes >= 0 && moveInRentKes <= rentKes * 2)) {
      return json({ error: 'Move-in rent must be from 0 up to twice the monthly rent.' }, 400);
    }

    // Verify tenant and tenancy belong to this company
    const { data: currentTenancy, error: tenancySearchErr } = await supabase
      .from('tenancies')
      .select('id, tenant_id')
      .eq('company_id', companyId)
      .eq('id', tenancyId)
      .single();

    if (tenancySearchErr || !currentTenancy) {
      return json({ error: 'Tenancy record not found for your company.' }, 404);
    }

    // 1. Update tenant personal info
    const { data: updatedTenant, error: tenantErr } = await supabase
      .from('tenants')
      .update({
        name: name.trim(),
        phone: parsedPhone.local,
        email: (email || '').trim(),
      })
      .eq('company_id', companyId)
      .eq('id', tenantId)
      .select('id, auth_user_id')
      .single();

    if (tenantErr) {
      if (tenantErr.code === '23505') {
        return json({ error: 'Another tenant already has this phone number in your company.' }, 409);
      }
      return json({ error: tenantErr.message }, 500);
    }

    // If tenant has an auth user, update their phone metadata
    if (updatedTenant?.auth_user_id) {
      try {
        await supabase.auth.admin.updateUserById(updatedTenant.auth_user_id, {
          user_metadata: {
            name: name.trim(),
            phone: parsedPhone.intl,
            company_id: companyId,
          },
        });
      } catch (authErr) {
        // Non-blocking for record correction
      }
    }

    // 2. Update tenancy financial & lease details
    const tenancyUpdates: Record<string, unknown> = {
      rent: rentKes,
      move_in_rent: moveInRentKes,
    };
    if (depositKes !== undefined) tenancyUpdates.deposit = depositKes;
    if (moveIn) tenancyUpdates.move_in = moveIn;
    if (leaseEnd) tenancyUpdates.lease_end = leaseEnd;

    const { error: tenancyUpdateErr } = await supabase
      .from('tenancies')
      .update(tenancyUpdates)
      .eq('company_id', companyId)
      .eq('id', tenancyId);

    if (tenancyUpdateErr) {
      return json({ error: tenancyUpdateErr.message }, 500);
    }

    // 3. Clear live cache & broadcast realtime update
    clearLiveCache(companyId);
    await notifyTenancy(supabase, tenancyId, 'data_updated');
    await notifyCompany(supabase, companyId, 'data_updated');

    return json({ ok: true, message: 'Tenant details successfully updated.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
};
