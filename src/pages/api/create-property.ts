import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyCompany } from '../../lib/realtime';
import { clearLiveCache } from '../../data/portfolio';

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Database not configured' }), { status: 500 });
  }

  try {
    const body = await request.json();
    const { name, managerId, type, address, accountPrefix, waterRate, garbageFee, units, imageUrl } = body;

    if (!name || !type || !accountPrefix || !Array.isArray(units) || units.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing required property details or units' }), { status: 400 });
    }

    const companyId = user.companyId;

    // The manager must be an owner or manager of this company. Checked here,
    // because properties.manager_id is a foreign key to staff.
    const { data: manager, error: managerErr } = await supabase
      .from('staff')
      .select('id')
      .eq('company_id', companyId)
      .eq('id', String(managerId ?? ''))
      .in('role', ['owner', 'manager'])
      .maybeSingle();
    if (managerErr) throw managerErr;
    if (!manager) {
      return new Response(JSON.stringify({ error: 'Choose a property manager from your team.' }), { status: 400 });
    }

    // No duplicates. Compared here first, with a clear message; the database's
    // unique indexes (see the properties migration) are the final guard.
    const wantName = String(name).trim().toLowerCase();
    const wantPrefix = String(accountPrefix).trim().toUpperCase();
    const labelKeys = units.map((u: { label?: unknown }) => String(u.label ?? '').trim().toLowerCase());
    if (labelKeys.some((l) => !l)) {
      return new Response(JSON.stringify({ error: 'Give every unit a label.' }), { status: 400 });
    }
    if (new Set(labelKeys).size !== labelKeys.length) {
      return new Response(JSON.stringify({ error: 'Two units have the same label.' }), { status: 400 });
    }

    const { data: existing, error: existingErr } = await supabase
      .from('properties')
      .select('name, account_prefix')
      .eq('company_id', companyId);
    if (existingErr) throw existingErr;
    if (existing?.some((p) => p.name.trim().toLowerCase() === wantName)) {
      return new Response(JSON.stringify({ error: `You already have a property called ${String(name).trim()}.` }), { status: 409 });
    }
    if (existing?.some((p) => p.account_prefix.toUpperCase() === wantPrefix)) {
      return new Response(JSON.stringify({ error: `Prefix ${wantPrefix} is already used by another of your properties.` }), { status: 409 });
    }

    // Insert property
    const { data: newProp, error: propErr } = await supabase
      .from('properties')
      .insert({
        company_id: companyId,
        manager_id: manager.id,
        name: name.trim(),
        type: type === 'houses' ? 'houses' : 'apartments',
        address: (address || '').trim(),
        account_prefix: accountPrefix.trim().toUpperCase(),
        water_rate: Math.round(Number(waterRate || 0)),
        garbage_fee: Math.round(Number(garbageFee || 0)),
        rate_history: [],
      })
      .select()
      .single();

    if (propErr) {
      // 23505: a unique index caught a duplicate that slipped past the check above.
      if (propErr.code === '23505') {
        return new Response(JSON.stringify({ error: 'A property with this name or prefix already exists.' }), { status: 409 });
      }
      throw propErr;
    }

    // If imageUrl was provided, store in company settings
    if (imageUrl) {
      try {
        const { data: comp } = await supabase.from('companies').select('settings').eq('id', companyId).single();
        if (comp) {
          const settings = comp.settings || {};
          const propertyImages = settings.propertyImages || {};
          propertyImages[newProp.id] = imageUrl.trim();
          await supabase.from('companies').update({
            settings: { ...settings, propertyImages },
          }).eq('id', companyId);
        }
      } catch (imgErr) {
        console.error('Failed to save property image:', imgErr);
      }
    }

    // Insert units
    const unitRows = units.map((u: { label: string; bedrooms: number }) => ({
      company_id: companyId,
      property_id: newProp.id,
      label: u.label.trim(),
      bedrooms: Math.max(0, Math.min(10, Math.round(Number(u.bedrooms || 1)))),
    }));

    const { error: unitsErr } = await supabase.from('units').insert(unitRows);
    if (unitsErr) {
      // Don't leave a property without its units: a retry would then create a second copy.
      await supabase.from('properties').delete().eq('company_id', companyId).eq('id', newProp.id);
      if (unitsErr.code === '23505') {
        return new Response(JSON.stringify({ error: 'Two units have the same label.' }), { status: 409 });
      }
      throw unitsErr;
    }

    clearLiveCache(companyId);

    await notifyCompany(supabase, companyId, 'data_updated', { action: 'property_created' });

    return new Response(
      JSON.stringify({
        success: true,
        propertyId: newProp.id,
        unitCount: unitRows.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const message = errorMessage(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
