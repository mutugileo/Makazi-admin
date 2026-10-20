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
    const { tenancyId } = await request.json();
    if (typeof tenancyId !== 'string' || !tenancyId) {
      return new Response(JSON.stringify({ error: 'Missing tenancyId' }), { status: 400 });
    }

    const companyId = user.companyId;

    // Update unread tenant messages in this tenancy to marked as read by staff
    const { error } = await supabase
      .from('messages')
      .update({ read_by_staff_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('tenancy_id', tenancyId)
      .eq('sender', 'tenant')
      .is('read_by_staff_at', null);

    if (error) throw error;

    clearLiveCache(companyId);

    // Notify the tenant app over realtime so its double ticks turn green!
    await notifyTenancy(supabase, tenancyId, 'data_updated');

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
