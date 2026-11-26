import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { clearLiveCache, markFresh } from '../../data/portfolio';
import { notifyCompany } from '../../lib/realtime';

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
    const { unitId, isListed, listedRent, listingNotes } = body;

    if (!unitId || typeof isListed !== 'boolean') {
      return new Response(JSON.stringify({ error: 'Unit ID and listing status are required.' }), { status: 400 });
    }

    const rentValue = listedRent !== undefined && listedRent !== null && listedRent !== ''
      ? Math.max(0, Math.round(Number(listedRent)))
      : null;

    const { data: updated, error } = await supabase
      .from('units')
      .update({
        is_listed: isListed,
        listed_rent: rentValue,
        // The list/unlist toggle sends no notes: keep the saved ones.
        ...(typeof listingNotes === 'string' ? { listing_notes: listingNotes.trim() } : {}),
      })
      .eq('company_id', user.companyId)
      .eq('id', unitId)
      .select('id, is_listed, listed_rent, listing_notes')
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: errorMessage(error) }), { status: 500 });
    }

    clearLiveCache(user.companyId);
    markFresh(cookies);
    notifyCompany(supabase, user.companyId, 'unit_updated');

    return new Response(JSON.stringify({ ok: true, unit: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = errorMessage(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

