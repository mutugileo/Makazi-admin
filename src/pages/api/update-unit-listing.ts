import type { APIRoute } from 'astro';
import { makeSupabaseClient } from '../../lib/supabase';
import { clearLiveCache } from '../../data/portfolio';
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
        listing_notes: typeof listingNotes === 'string' ? listingNotes.trim() : '',
      })
      .eq('company_id', user.companyId)
      .eq('id', unitId)
      .select('id, is_listed, listed_rent, listing_notes')
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    clearLiveCache(user.companyId);
    notifyCompany(user.companyId);

    return new Response(JSON.stringify({ ok: true, unit: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

