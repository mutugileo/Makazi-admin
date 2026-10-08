import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
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
    const { tenancyId, moveOutDate, note } = body;

    if (!tenancyId || !moveOutDate) {
      return new Response(JSON.stringify({ error: 'Missing tenancyId or moveOutDate' }), { status: 400 });
    }

    const companyId = user.companyId;

    const { data: updated, error } = await supabase
      .from('tenancies')
      .update({
        move_out: moveOutDate,
        move_out_note: (note || '').trim() || null,
      })
      .eq('company_id', companyId)
      .eq('id', tenancyId)
      .select('id');

    if (error) throw error;
    if (!updated?.length) {
      return new Response(JSON.stringify({ error: 'Tenancy not found' }), { status: 404 });
    }

    clearLiveCache(companyId);
    await notifyTenancy(supabase, tenancyId, 'data_updated', { action: 'move_out' });

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
