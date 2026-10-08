import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';

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
    const { tenancyId, isTyping } = await request.json();
    const companyId = user.companyId;

    if (typeof tenancyId !== 'string' || !tenancyId) {
      return new Response(JSON.stringify({ error: 'Missing tenancyId' }), { status: 400 });
    }
    // Only for a tenancy of this company.
    const { data: own, error } = await supabase
      .from('tenancies').select('id').eq('company_id', companyId).eq('id', tenancyId).maybeSingle();
    if (error) throw error;
    if (!own) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

    await notifyTenancy(supabase, tenancyId, 'typing', { isTyping: Boolean(isTyping) });

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
