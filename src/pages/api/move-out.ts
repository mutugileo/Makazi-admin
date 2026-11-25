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

    if (typeof moveOutDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(moveOutDate)) {
      return new Response(JSON.stringify({ error: 'Pick a move-out date.' }), { status: 400 });
    }
    const { data: tenancy, error: readErr } = await supabase
      .from('tenancies')
      .select('id, move_in, move_out')
      .eq('company_id', companyId)
      .eq('id', tenancyId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!tenancy) {
      return new Response(JSON.stringify({ error: 'Tenancy not found' }), { status: 404 });
    }
    if (tenancy.move_out) {
      return new Response(JSON.stringify({ error: 'This tenant has already moved out.' }), { status: 409 });
    }
    if (moveOutDate < tenancy.move_in) {
      return new Response(JSON.stringify({ error: 'The move-out date can\'t be before the move-in date.' }), { status: 400 });
    }

    const { data: updated, error } = await supabase
      .from('tenancies')
      .update({
        move_out: moveOutDate,
        move_out_note: (note || '').trim() || null,
      })
      .eq('company_id', companyId)
      .eq('id', tenancyId)
      .is('move_out', null)
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
