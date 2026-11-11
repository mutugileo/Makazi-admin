import type { APIRoute } from 'astro';
import { cycleOf } from '../../lib/billing';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { clearLiveCache } from '../../data/portfolio';
import { generateOneTimePassword, issueOneTimePassword, parseKenyanPhone, phoneSpellings } from '../../lib/tenant-auth';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALPHANUMERIC_UNIT = /^[A-Za-z0-9\s\-_.]+$/;

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = await request.json();
    const {
      name,
      phone: rawPhone,
      email,
      unitId,
      propertyId,
      unitLabel,
      bedrooms,
      rent,
      deposit,
      moveIn,
      moveInRent,
      openingReading,
      leaseTerm,
      moveInGarbage,
    } = body;

    if (!name || !rawPhone || (!unitId && (!propertyId || !unitLabel)) || !rent || !moveIn) {
      return json({ error: 'Missing required onboarding fields' }, 400);
    }

    const phone = parseKenyanPhone(rawPhone);
    if (!phone) return json({ error: 'Enter a valid Safaricom or Airtel number' }, 400);

    const rentKes = Math.round(Number(rent));
    const depositKes = Math.round(Number(deposit || 0));
    if (!(rentKes > 0) || !(depositKes >= 0)) return json({ error: 'Rent and deposit must be valid amounts' }, 400);
    if (typeof moveIn !== 'string' || !ISO_DATE.test(moveIn)) return json({ error: 'Move-in must be a valid date' }, 400);

    // Rent on the move-in bill, entered by the landlord for the days until the
    // next billing cycle.
    const moveInRentKes = moveInRent === '' || moveInRent == null ? NaN : Math.round(Number(moveInRent));
    if (!(moveInRentKes >= 0 && moveInRentKes <= rentKes * 2)) {
      return json({ error: 'Enter the move-in rent: from 0 up to twice the monthly rent' }, 400);
    }

    const reading = openingReading === null || openingReading === undefined || openingReading === '' ? null : Number(openingReading);
    if (reading !== null && !(Number.isFinite(reading) && reading >= 0)) return json({ error: 'Meter reading must be 0 or more' }, 400);

    const garbageKes = moveInGarbage === null || moveInGarbage === undefined || moveInGarbage === '' ? 0 : Math.round(Number(moveInGarbage));
    if (garbageKes !== null && !(Number.isFinite(garbageKes) && garbageKes >= 0)) return json({ error: 'Move-in garbage must be 0 or more' }, 400);

    const companyId = user.companyId;

    // Resolve or create the admin's alphanumeric unit preset
    let resolvedUnitId = unitId ? String(unitId).trim() : '';
    let finalUnitLabel = '';

    if (!resolvedUnitId) {
      const cleanLabel = String(unitLabel || '').trim();
      if (!cleanLabel) {
        return json({ error: 'Alphanumeric unit label is required' }, 400);
      }
      if (!ALPHANUMERIC_UNIT.test(cleanLabel)) {
        return json({ error: 'Unit label must be alphanumeric (e.g. A1, 102, B-4, Villa 1)' }, 400);
      }
      if (cleanLabel.length > 40) {
        return json({ error: 'Unit label cannot exceed 40 characters' }, 400);
      }

      // Check if unit already exists under this property
      const { data: propUnits, error: fetchErr } = await supabase
        .from('units')
        .select('id, label')
        .eq('company_id', companyId)
        .eq('property_id', propertyId);
      if (fetchErr) throw fetchErr;

      const existingUnit = propUnits?.find((u) => u.label.trim().toLowerCase() === cleanLabel.toLowerCase());

      if (existingUnit) {
        resolvedUnitId = existingUnit.id;
        finalUnitLabel = existingUnit.label;
      } else {
        // Create new alphanumeric unit preset set by the admin
        const bedroomCount = Math.max(0, Math.min(10, parseInt(String(bedrooms), 10) || 1));
        const { data: createdUnit, error: createErr } = await supabase
          .from('units')
          .insert({
            company_id: companyId,
            property_id: propertyId,
            label: cleanLabel,
            bedrooms: bedroomCount,
            is_listed: false,
          })
          .select('id, label')
          .single();
        if (createErr || !createdUnit) throw createErr || new Error('Failed to create unit preset');
        resolvedUnitId = createdUnit.id;
        finalUnitLabel = createdUnit.label;
      }
    }

    // Verify unit doesn't have an active tenant
    const { data: activeTenancy, error: activeErr } = await supabase
      .from('tenancies')
      .select('id')
      .eq('company_id', companyId)
      .eq('unit_id', resolvedUnitId)
      .is('move_out', null)
      .maybeSingle();
    if (activeErr) throw activeErr;
    if (activeTenancy) {
      return json({ error: `Unit ${finalUnitLabel || ''} already has an active tenant` }, 409);
    }

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

    const { data: newTenancy, error: tenancyErr } = await supabase
      .from('tenancies')
      .insert({
        company_id: companyId,
        tenant_id: tenantId,
        unit_id: resolvedUnitId,
        rent: rentKes,
        deposit: depositKes,
        move_in: moveIn,
        move_in_rent: moveInRentKes,
        lease_start: moveIn,
        lease_end: leaseEnd.toISOString().slice(0, 10),
        opening_reading: reading,
        opening_balance: 0,
        move_in_garbage: garbageKes,
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
          { company_id: companyId, unit_id: resolvedUnitId, month: cycleOf(moveIn), value: reading },
          { onConflict: 'unit_id,month' },
        );
      if (readingErr) console.error('[onboard-tenant] opening reading not saved:', readingErr);
    }

    // Send in-app notification for the newly generated 4-digit PIN (72h validity)
    const { error: notifErr } = await supabase.from('notifications').insert({
      company_id: companyId,
      tenancy_id: newTenancy.id,
      kind: 'payment_reminder',
      title: 'Security: New 4-digit PIN generated',
      body: `Your Makazi login PIN is ${temporaryPassword}. Valid for 72 hours. You can change your PIN anytime in the app under Account settings.`,
    });
    if (notifErr) console.warn('[onboard-tenant] notification warning:', notifErr);

    clearLiveCache(companyId);

    return json({
      success: true,
      tenantId,
      tenancyId: newTenancy.id,
      temporaryPassword,
      pin: temporaryPassword,
      unitId: resolvedUnitId,
    });
  } catch (err: unknown) {
    return json({ error: errorMessage(err, 'Failed to onboard tenant') }, 500);
  }
};
