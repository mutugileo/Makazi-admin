import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { clearLiveCache } from '../../data/portfolio';
import { generateOneTimePassword, issueOneTimePassword, parseKenyanPhone, phoneSpellings } from '../../lib/tenant-auth';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = await request.json();
    const { name, phone: rawPhone, email, unitId, rent, deposit, moveIn, openingReading, leaseTerm } = body;

    if (!name || !rawPhone || !unitId || !rent || !moveIn) return json({ error: 'Missing required fields' }, 400);
    const phone = parseKenyanPhone(rawPhone);
    if (!phone) return json({ error: 'Enter a valid Safaricom or Airtel number' }, 400);
    const rentKes = Math.round(Number(rent));
    const depositKes = Math.round(Number(deposit || 0));
    if (!(rentKes > 0) || !(depositKes >= 0)) return json({ error: 'Rent and deposit must be valid amounts' }, 400);
    if (typeof moveIn !== 'string' || !ISO_DATE.test(moveIn)) return json({ error: 'Move-in must be a date' }, 400);
    const reading = openingReading === null || openingReading === undefined || openingReading === '' ? null : Number(openingReading);
    if (reading !== null && !(Number.isFinite(reading) && reading >= 0)) return json({ error: 'Meter reading must be 0 or more' }, 400);

    const companyId = user.companyId;

    // One tenant record per phone per company; a returning tenant keeps theirs.
    const { data: existing, error: searchErr } = await supabase
      .from('tenants')
      .select('id, auth_user_id')
      .eq('company_id', companyId)
      .in('phone', phoneSpellings(phone))
      .maybeSingle();
    if (searchErr) throw searchErr;

    let tenantId: string;
    let createdTenant = false;
    if (existing) {
      tenantId = existing.id;
    } else {
      const { data: newTenant, error } = await supabase
        .from('tenants')
        .insert({ company_id: companyId, name: String(name).trim(), phone: phone.local, email: String(email || '').trim() })
        .select('id')
        .single();
      if (error) throw error;
      tenantId = newTenant.id;
      createdTenant = true;
    }

    const termMonths = Math.max(1, Math.min(60, Number(leaseTerm) || 12));
    const leaseEnd = new Date(`${moveIn}T00:00:00Z`);
    leaseEnd.setUTCMonth(leaseEnd.getUTCMonth() + termMonths);
    leaseEnd.setUTCDate(leaseEnd.getUTCDate() - 1);

    // The database refuses a unit that already has a current tenant, or one
    // from another company (composite foreign key).
    const { data: newTenancy, error: tenancyErr } = await supabase
      .from('tenancies')
      .insert({
        company_id: companyId,
        tenant_id: tenantId,
        unit_id: unitId,
        rent: rentKes,
        deposit: depositKes,
        move_in: moveIn,
        lease_start: moveIn,
        lease_end: leaseEnd.toISOString().slice(0, 10),
        opening_reading: reading ?? 0,
        opening_balance: 0,
      })
      .select('id')
      .single();
    if (tenancyErr) {
      if (createdTenant) await supabase.from('tenants').delete().eq('company_id', companyId).eq('id', tenantId);
      if (tenancyErr.code === '23505') return json({ error: 'That unit already has a current tenant' }, 409);
      throw tenancyErr;
    }

    const temporaryPassword = generateOneTimePassword();
    try {
      const authUserId = await issueOneTimePassword(supabase, {
        phone,
        password: temporaryPassword,
        name: String(name).trim(),
        companyId,
        knownUserId: existing?.auth_user_id,
      });
      const { error: linkErr } = await supabase
        .from('tenants')
        .update({ auth_user_id: authUserId })
        .eq('company_id', companyId)
        .eq('id', tenantId);
      if (linkErr) throw linkErr;
    } catch (authErr) {
      // No half-onboarded tenant: undo the rows written above.
      await supabase.from('tenancies').delete().eq('company_id', companyId).eq('id', newTenancy.id);
      if (createdTenant) await supabase.from('tenants').delete().eq('company_id', companyId).eq('id', tenantId);
      throw authErr;
    }

    if (reading !== null) {
      const { error: readingErr } = await supabase
        .from('meter_readings')
        .upsert(
          { company_id: companyId, unit_id: unitId, month: moveIn.slice(0, 7), value: reading },
          { onConflict: 'unit_id,month' },
        );
      if (readingErr) console.error('[onboard-tenant] opening reading not saved:', readingErr);
    }

    clearLiveCache(companyId);

    return json({
      success: true,
      tenantId,
      tenancyId: newTenancy.id,
      temporaryPassword,
      authEmail: phone.authEmail,
      message: `Your Makazi one-time password is ${temporaryPassword}. Sign in with ${phone.local}, then choose your own password.`,
    });
  } catch (err: unknown) {
    console.error('[onboard-tenant]', err);
    return json({ error: errorMessage(err) }, 500);
  }
};
