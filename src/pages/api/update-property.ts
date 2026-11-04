import type { APIRoute } from 'astro';
import { makeSupabaseClient } from '../../lib/supabase';
import { clearLiveCache } from '../../data/portfolio';
import { notifyCompany } from '../../lib/realtime';

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
    const { propertyId, name, address, accountPrefix, type, waterRate, garbageFee } = body;

    if (!propertyId || !name || !accountPrefix) {
      return json({ error: 'Property ID, name, and account prefix are required.' }, 400);
    }

    const companyId = user.companyId;
    const cleanName = name.trim();
    const cleanPrefix = accountPrefix.trim().toUpperCase();

    // Check for duplicates in company (excluding current property)
    const { data: existing, error: existingErr } = await supabase
      .from('properties')
      .select('id, name, account_prefix')
      .eq('company_id', companyId)
      .neq('id', propertyId);

    if (existingErr) throw existingErr;

    if (existing?.some((p) => p.name.trim().toLowerCase() === cleanName.toLowerCase())) {
      return json({ error: `You already have another property named '${cleanName}'.` }, 409);
    }
    if (existing?.some((p) => p.account_prefix.toUpperCase() === cleanPrefix)) {
      return json({ error: `Account prefix '${cleanPrefix}' is already used by another property.` }, 409);
    }

    const updatePayload: Record<string, unknown> = {
      name: cleanName,
      address: (address || '').trim(),
      account_prefix: cleanPrefix,
    };

    if (type === 'apartments' || type === 'houses') {
      updatePayload.type = type;
    }
    if (waterRate !== undefined && waterRate !== null) {
      updatePayload.water_rate = Math.max(0, Math.round(Number(waterRate)));
    }
    if (garbageFee !== undefined && garbageFee !== null) {
      updatePayload.garbage_fee = Math.max(0, Math.round(Number(garbageFee)));
    }

    const { data: updated, error: updateErr } = await supabase
      .from('properties')
      .update(updatePayload)
      .eq('company_id', companyId)
      .eq('id', propertyId)
      .select()
      .single();

    if (updateErr) {
      if (updateErr.code === '23505') {
        return json({ error: 'A property with this name or prefix already exists.' }, 409);
      }
      return json({ error: updateErr.message }, 500);
    }

    clearLiveCache(companyId);
    await notifyCompany(supabase, companyId, 'data_updated');

    return json({ ok: true, property: updated, message: 'Property details updated successfully.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
};

