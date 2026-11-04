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
    const { unitId, label, bedrooms } = body;

    if (!unitId || !label) {
      return json({ error: 'Unit ID and unit label are required.' }, 400);
    }

    const companyId = user.companyId;
    const cleanLabel = String(label).trim();

    if (cleanLabel.length < 1 || cleanLabel.length > 40) {
      return json({ error: 'Unit label must be between 1 and 40 characters.' }, 400);
    }

    const beds = bedrooms !== undefined ? Math.max(0, Math.min(10, parseInt(String(bedrooms), 10) || 0)) : undefined;

    // Fetch existing unit to get property_id
    const { data: currentUnit, error: fetchErr } = await supabase
      .from('units')
      .select('id, property_id')
      .eq('company_id', companyId)
      .eq('id', unitId)
      .single();

    if (fetchErr || !currentUnit) {
      return json({ error: 'Unit not found.' }, 404);
    }

    // Check duplicate label within property
    const { data: duplicateCheck } = await supabase
      .from('units')
      .select('id')
      .eq('company_id', companyId)
      .eq('property_id', currentUnit.property_id)
      .eq('label', cleanLabel)
      .neq('id', unitId)
      .maybeSingle();

    if (duplicateCheck) {
      return json({ error: `Unit label '${cleanLabel}' already exists in this property.` }, 409);
    }

    const updatePayload: Record<string, unknown> = {
      label: cleanLabel,
    };
    if (beds !== undefined) updatePayload.bedrooms = beds;

    const { data: updated, error: updateErr } = await supabase
      .from('units')
      .update(updatePayload)
      .eq('company_id', companyId)
      .eq('id', unitId)
      .select()
      .single();

    if (updateErr) {
      if (updateErr.code === '23505') {
        return json({ error: 'A unit with this label already exists in this property.' }, 409);
      }
      return json({ error: updateErr.message }, 500);
    }

    clearLiveCache(companyId);
    await notifyCompany(supabase, companyId, 'data_updated');

    return json({ ok: true, unit: updated, message: 'Unit updated successfully.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
};

