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
    const payload = await request.json();
    const { tenancyId, body: messageBody } = payload;

    if (!tenancyId || !messageBody) {
      return new Response(JSON.stringify({ error: 'Missing tenancyId or message text' }), { status: 400 });
    }

    const companyId = user.companyId;

    // Retrieve staff member id
    const { data: staffRows } = await supabase
      .from('staff')
      .select('id')
      .eq('company_id', companyId)
      .limit(1);

    const staffId = staffRows && staffRows.length > 0 ? staffRows[0].id : 's-owner';

    const { data: newMessage, error } = await supabase
      .from('messages')
      .insert({
        company_id: companyId,
        tenancy_id: tenancyId,
        sender: 'staff',
        staff_id: staffId,
        body: messageBody.trim(),
      })
      .select()
      .single();

    if (error) throw error;

    clearLiveCache(companyId);

    // Tell only this tenant's app; it re-reads the message through RLS.
    await notifyTenancy(supabase, newMessage.tenancy_id, 'message_sent', { id: newMessage.id });

    return new Response(
      JSON.stringify({
        success: true,
        messageId: newMessage.id,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const message = errorMessage(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
