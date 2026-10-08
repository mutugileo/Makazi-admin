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
    const { name, type, address, accountPrefix, waterRate, garbageFee, units, imageUrl } = body;

    if (!name || !type || !accountPrefix || !Array.isArray(units) || units.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing required property details or units' }), { status: 400 });
    }

    const companyId = user.companyId;

    // Retrieve manager staff id
    const { data: staffRows } = await supabase
      .from('staff')
      .select('id')
      .eq('company_id', companyId)
      .limit(1);

    const managerId = staffRows && staffRows.length > 0 ? staffRows[0].id : 's-owner';

    // Insert property
    const { data: newProp, error: propErr } = await supabase
      .from('properties')
      .insert({
        company_id: companyId,
        manager_id: managerId,
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

    if (propErr) throw propErr;

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
    if (unitsErr) throw unitsErr;

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
