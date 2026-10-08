import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
import { parseKenyanPhone } from '../../lib/tenant-auth';
import { clearLiveCache } from '../../data/portfolio';

const STATUSES = new Set(['open', 'in_progress', 'resolved']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Moves a repair along the board. Starting work ("in_progress") needs who is
 * going and their mobile; the visit time is optional. The tenant sees all
 * three inside the request in the app.
 *
 * Body: { ticketId, status, assignee?: { name, phone, visitAt }, resolutionNote? }
 * visitAt is the admin's <input type="datetime-local"> value ('YYYY-MM-DDTHH:MM'),
 * read as Nairobi time.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = await request.json();
    const { ticketId, status, assignee, resolutionNote } = body ?? {};

    if (typeof ticketId !== 'string' || !ticketId || !STATUSES.has(status)) {
      return json({ error: 'Missing ticket or status' }, 400);
    }

    const updateData: Record<string, unknown> = { status };

    if (assignee !== undefined || status === 'in_progress') {
      const name = typeof assignee?.name === 'string' ? assignee.name.trim().replace(/\s+/g, ' ') : '';
      if (name.length < 2 || name.length > 80) {
        return json({ error: 'Enter the name of who is going to fix it.' }, 400);
      }
      const phone = parseKenyanPhone(assignee?.phone);
      if (!phone) {
        return json({ error: 'Enter their Safaricom or Airtel number, e.g. 0712 345 678.' }, 400);
      }
      let visitAt: string | null = null;
      const rawVisit = typeof assignee?.visitAt === 'string' ? assignee.visitAt.trim() : '';
      if (rawVisit) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawVisit)) {
          return json({ error: 'Pick a visit date and time.' }, 400);
        }
        visitAt = `${rawVisit}:00+03:00`;
        const when = Date.parse(visitAt);
        const day = 24 * 60 * 60 * 1000;
        // Allow logging a visit that already happened today; nothing absurd.
        if (Number.isNaN(when) || when < Date.now() - day || when > Date.now() + 90 * day) {
          return json({ error: 'The visit should be from today up to 90 days ahead.' }, 400);
        }
      }
      updateData.assigned_to = name;
      updateData.assigned_phone = phone.intl;
      updateData.visit_at = visitAt;
    }

    if (resolutionNote !== undefined) {
      const note = typeof resolutionNote === 'string' ? resolutionNote.trim() : '';
      updateData.resolution_note = note ? note.slice(0, 2000) : null;
    }
    if (status === 'resolved') updateData.resolved_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('repair_tickets')
      .update(updateData)
      .eq('company_id', user.companyId)
      .eq('id', ticketId)
      .select('tenancy_id');

    if (error) throw error;
    if (!updated?.length) return json({ error: 'Ticket not found' }, 404);

    clearLiveCache(user.companyId);
    // Ids only (realtime.ts): the app refetches through its own access rules.
    await notifyTenancy(supabase, updated[0].tenancy_id, 'data_updated', { action: 'ticket_updated' });

    return json({ success: true });
  } catch (err: unknown) {
    return json({ error: errorMessage(err) }, 500);
  }
};
