import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { Buffer } from 'node:buffer';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
import { clearLiveCache, markFresh } from '../../data/portfolio';

const MAX_BYTES = 5 * 1024 * 1024;

/** The only photo types accepted, and the extension each is stored with. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** The file's first bytes must match the type it claims. */
function matchesMagicBytes(type: string, bytes: Uint8Array): boolean {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (type === 'image/jpeg') return starts([0xff, 0xd8, 0xff]);
  if (type === 'image/png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (type === 'image/webp') return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
  return false;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const ticketId = formData.get('ticketId');

    if (typeof ticketId !== 'string' || !ticketId || !(file instanceof File)) {
      return json({ error: 'Ticket ID and photo file are required.' }, 400);
    }

    const ext = EXTENSIONS[file.type];
    if (!ext) {
      return json({ error: 'Please choose a JPEG, PNG or WebP photo.' }, 400);
    }
    if (file.size > MAX_BYTES) {
      return json({ error: 'That photo is larger than 5 MB. Choose a smaller one.' }, 413);
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

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    if (fileBuffer.length > MAX_BYTES) {
      return json({ error: 'That photo is larger than 5 MB. Choose a smaller one.' }, 413);
    }
    if (!matchesMagicBytes(file.type, fileBuffer)) {
      return json({ error: "That file isn't a JPEG, PNG or WebP photo. Choose another." }, 400);
    }

    // Upload to repair-photos bucket; the extension comes from the checked type.
    const storagePath = `${ticket.company_id}/${ticket.tenancy_id}/${ticket.id}.${ext}`;

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
    markFresh(cookies);
    await notifyTenancy(supabase, ticket.tenancy_id, 'data_updated', { action: 'ticket_updated' });

    return json({ success: true, photoUrl });
  } catch (err: unknown) {
    const message = errorMessage(err);
    return json({ error: message }, 500);
  }
};

