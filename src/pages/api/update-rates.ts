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
    const { propertyId, waterRate, garbageFee } = body;

    if (!propertyId || waterRate == null || garbageFee == null) {
      return new Response(JSON.stringify({ error: 'Missing propertyId or rate values' }), { status: 400 });
    }

    const companyId = user.companyId;
    const water = Math.round(Number(waterRate));
    const garbage = Math.round(Number(garbageFee));
    if (!Number.isFinite(water) || !Number.isFinite(garbage) || water < 0 || garbage < 0) {
      return new Response(JSON.stringify({ error: 'Rates must be whole shillings, 0 or more' }), { status: 400 });
    }

    const { data: property, error: readErr } = await supabase
      .from('properties')
      .select('rate_history')
      .eq('company_id', companyId)
      .eq('id', propertyId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!property) {
      return new Response(JSON.stringify({ error: 'Property not found' }), { status: 404 });
    }

    // The billing engine prices each month from rate_history, so new rates go
    // in as an entry from next month (Nairobi time); issued bills keep theirs.
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
    now.setUTCDate(1);
    now.setUTCMonth(now.getUTCMonth() + 1);
    const from = now.toISOString().slice(0, 7);
    const history = ((property.rate_history ?? []) as Array<{ from: string; waterRate: number; garbageFee: number }>)
      .filter((r) => r.from !== from)
      .concat({ from, waterRate: water, garbageFee: garbage })
      .sort((x, y) => x.from.localeCompare(y.from));

    const { error } = await supabase
      .from('properties')
      .update({ water_rate: water, garbage_fee: garbage, rate_history: history })
      .eq('company_id', companyId)
      .eq('id', propertyId);

    if (error) throw error;

    clearLiveCache(companyId);
    await notifyCompany(supabase, companyId, 'data_updated', { action: 'rates_updated' });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = errorMessage(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
