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
    const readings = body.readings as Array<{ unitId: string; month: string; value: number }>;

    if (!Array.isArray(readings) || readings.length === 0) {
      return new Response(JSON.stringify({ error: 'No readings provided' }), { status: 400 });
    }

    const companyId = user.companyId;
    const rows = readings.map((r) => ({
      company_id: companyId,
      unit_id: r.unitId,
      month: r.month,
      value: Math.round(Number(r.value)),
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
