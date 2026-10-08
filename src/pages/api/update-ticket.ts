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
    const { ticketId, status, assignedTo, resolutionNote } = body;

    if (!ticketId || !status) {
      return new Response(JSON.stringify({ error: 'Missing ticket ID or status' }), { status: 400 });
    }

    const companyId = user.companyId;
    const updateData: Record<string, unknown> = {
      status,
    };
    if (assignedTo !== undefined) updateData.assigned_to = assignedTo;
    if (resolutionNote !== undefined) updateData.resolution_note = resolutionNote;
    if (status === 'resolved') updateData.resolved_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('repair_tickets')
      .update(updateData)
      .eq('company_id', companyId)
      .eq('id', ticketId)
      .select('tenancy_id');

    if (error) throw error;
    if (!updated?.length) {
      return new Response(JSON.stringify({ error: 'Ticket not found' }), { status: 404 });
    }

    clearLiveCache(companyId);
    await notifyTenancy(supabase, updated[0].tenancy_id, 'data_updated', { action: 'ticket_updated' });

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
