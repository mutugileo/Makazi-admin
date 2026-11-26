import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
import { clearLiveCache, markFresh } from '../../data/portfolio';

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

    if (typeof tenancyId !== 'string' || !tenancyId || typeof messageBody !== 'string' || !messageBody.trim()) {
      return new Response(JSON.stringify({ error: 'Missing tenancyId or message text' }), { status: 400 });
    }
    if (messageBody.trim().length > 2000) {
      return new Response(JSON.stringify({ error: 'Keep the message to 2,000 characters or fewer.' }), { status: 400 });
    }

    const companyId = user.companyId;

    // The tenancy id comes from the client: it must be one of this company's.
    const { data: ownTenancy, error: tenancyErr } = await supabase
      .from('tenancies')
      .select('id')
      .eq('company_id', companyId)
      .eq('id', tenancyId)
      .maybeSingle();
    if (tenancyErr) throw tenancyErr;
    if (!ownTenancy) {
      return new Response(JSON.stringify({ error: 'Tenancy not found' }), { status: 404 });
    }

    // The message is signed by whoever is signed in: the staff id saved in the
    // session, else (older sessions) the one owner or manager with this name,
    // else the company's owner.
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff')
      .select('id, name, role')
      .eq('company_id', companyId)
      .in('role', ['owner', 'manager']);
    if (staffErr) throw staffErr;
    const team = staffRows ?? [];
    const byName = team.filter((s) => s.name?.trim().toLowerCase() === user.name.trim().toLowerCase());
    const staffId =
      team.find((s) => s.id === user.staffId)?.id ??
      (byName.length === 1 ? byName[0].id : undefined) ??
      team.find((s) => s.role === 'owner')?.id ??
      team[0]?.id;
    if (!staffId) {
      return new Response(JSON.stringify({ error: 'Add yourself as an owner or manager in Settings before sending messages.' }), { status: 409 });
    }

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
    markFresh(cookies);

    // Also record in notifications inbox so the tenant's badge & alerts update.
    // The message itself is saved: a failure here is logged, not shown.
    const { data: comp, error: compErr } = await supabase.from('companies').select('name').eq('id', companyId).maybeSingle();
    if (compErr) console.error('[send-message] company name not read:', compErr);
    const senderTitle = comp?.name ? `Message from ${comp.name}` : 'Message from Makazi';
    const { error: notifErr } = await supabase.from('notifications').insert({
      company_id: companyId,
      tenancy_id: tenancyId,
      kind: 'message',
      title: senderTitle,
      body: messageBody.trim(),
    });
    if (notifErr) console.error('[send-message] tenant notification not saved:', notifErr);

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
