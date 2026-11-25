import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyCompany } from '../../lib/realtime';
import { clearLiveCache } from '../../data/portfolio';
import { addMonths, cycleOf } from '../../lib/billing';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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
    const readings = body.readings as Array<{ unitId: string; month: string; value: number }>;

    if (!Array.isArray(readings) || readings.length === 0) {
      return new Response(JSON.stringify({ error: 'No readings provided' }), { status: 400 });
    }

    const companyId = user.companyId;

    // Unit ids come from the client: every one must be a unit of this company,
    // or the upsert would overwrite another landlord's meter readings.
    const unitIds = [...new Set(readings.map((r) => r.unitId))];
    const { data: ownUnits, error: unitsError } = await supabase
      .from('units')
      .select('id')
      .eq('company_id', companyId)
      .in('id', unitIds);
    if (unitsError) throw unitsError;
    if ((ownUnits?.length ?? 0) !== unitIds.length) {
      return new Response(JSON.stringify({ error: 'Unit not found' }), { status: 404 });
    }

    // Only this cycle or a late reading for the last one: a future month would
    // bill water for a cycle that hasn't started.
    const currentCycle = cycleOf(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10));
    const allowedMonths = new Set([currentCycle, addMonths(currentCycle, -1)]);
    for (const r of readings) {
      if (!allowedMonths.has(r.month)) {
        return json({ error: 'Readings can only be saved for this billing cycle or the one before it.' }, 400);
      }
      if (!Number.isInteger(Number(r.value)) || Number(r.value) < 0) {
        return json({ error: 'A meter reading must be a whole number, 0 or more.' }, 400);
      }
    }

    // A meter only counts up: each reading must sit between its neighbours.
    const { data: existing, error: existingError } = await supabase
      .from('meter_readings')
      .select('unit_id, month, value')
      .eq('company_id', companyId)
      .in('unit_id', unitIds);
    if (existingError) throw existingError;
    for (const r of readings) {
      const others = (existing ?? []).filter((e) => e.unit_id === r.unitId && e.month !== r.month);
      const before = others.filter((e) => e.month < r.month).sort((a, b) => b.month.localeCompare(a.month))[0];
      const after = others.filter((e) => e.month > r.month).sort((a, b) => a.month.localeCompare(b.month))[0];
      const value = Number(r.value);
      if (before && value < before.value) {
        return json({ error: `A reading of ${value} is below the last one (${before.value}). Check the meter and try again.` }, 400);
      }
      if (after && value > after.value) {
        return json({ error: `A reading of ${value} is above the next saved one (${after.value}). Check the meter and try again.` }, 400);
      }
    }

    const rows = readings.map((r) => ({
      company_id: companyId,
      unit_id: r.unitId,
      month: r.month,
      value: Number(r.value),
    }));

    const { error } = await supabase
      .from('meter_readings')
      .upsert(rows, { onConflict: 'unit_id,month' });

    if (error) throw error;

    clearLiveCache(companyId);

    await notifyCompany(supabase, companyId, 'data_updated', { action: 'meter_reading' });

    return new Response(JSON.stringify({ success: true, count: rows.length }), {
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
