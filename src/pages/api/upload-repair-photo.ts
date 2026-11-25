import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { Buffer } from 'node:buffer';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
import { clearLiveCache } from '../../data/portfolio';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const ticketId = formData.get('ticketId') as string | null;

    if (!ticketId || !file) {
      return json({ error: 'Ticket ID and photo file are required.' }, 400);
    }

    if (!file.type.startsWith('image/')) {
      return json({ error: 'Please choose an image file (JPEG, PNG, or WebP).' }, 400);
    }

    // Check ticket ownership
    const { data: ticket, error: fetchErr } = await supabase
      .from('repair_tickets')
      .select('id, company_id, tenancy_id')
      .eq('company_id', user.companyId)
      .eq('id', ticketId)
      .single();

    if (fetchErr || !ticket) {
      return json({ error: 'Ticket not found.' }, 404);
    }

    // Upload to repair-photos bucket
    const ext = file.name.split('.').pop() || 'jpg';
    const storagePath = `${ticket.company_id}/${ticket.tenancy_id}/${ticket.id}.${ext}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await supabase.storage
      .from('repair-photos')
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadErr) {
      throw uploadErr;
    }

    // Store the storage path in repair_tickets.photo_url and return a signed URL for preview.
    const { error: updateErr } = await supabase
      .from('repair_tickets')
      .update({
        photo_url: storagePath,
        has_photo: true,
      })
      .eq('company_id', user.companyId)
      .eq('id', ticketId);

    if (updateErr) throw updateErr;

    const { data: signedData } = await supabase.storage
      .from('repair-photos')
      .createSignedUrl(storagePath, 3600);
    const photoUrl = signedData?.signedUrl ?? null;

    clearLiveCache(user.companyId);
    await notifyTenancy(supabase, ticket.tenancy_id, 'data_updated', { action: 'ticket_updated' });

    return json({ success: true, photoUrl });
  } catch (err: unknown) {
    const message = errorMessage(err);
    return json({ error: message }, 500);
  }
};

