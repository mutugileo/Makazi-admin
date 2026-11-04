import type { APIRoute } from 'astro';
import { makeSupabaseClient } from '../../lib/supabase';
import { parseKenyanPhone } from '../../lib/tenant-auth';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async ({ url, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  const propertyId = url.searchParams.get('propertyId');
  const status = url.searchParams.get('status');

  let query = supabase
    .from('property_enquiries')
    .select('*, properties:property_id(name), units:unit_id(label)')
    .eq('company_id', user.companyId)
    .order('created_at', { ascending: false });

  if (propertyId) query = query.eq('property_id', propertyId);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, enquiries: data });
};

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = await request.json();
    const { propertyId, unitId, name, phone: rawPhone, email, source, notes, viewingAt } = body;

    if (!propertyId || !name || !rawPhone) {
      return json({ error: 'Property, applicant name, and phone number are required.' }, 400);
    }

    const phoneParsed = parseKenyanPhone(rawPhone);
    const phone = phoneParsed ? phoneParsed.local : rawPhone.trim();

    const { data: newEnquiry, error } = await supabase
      .from('property_enquiries')
      .insert({
        company_id: user.companyId,
        property_id: propertyId,
        unit_id: unitId || null,
        name: name.trim(),
        phone,
        email: (email || '').trim(),
        source: source || 'walk_in',
        status: viewingAt ? 'viewing_scheduled' : 'new',
        viewing_at: viewingAt || null,
        notes: (notes || '').trim(),
      })
      .select('*, properties:property_id(name), units:unit_id(label)')
      .single();

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, enquiry: newEnquiry }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
};

export const PATCH: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = await request.json();
    const { id, status, viewingAt, notes, unitId } = body;

    if (!id) return json({ error: 'Enquiry ID is required.' }, 400);

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (status !== undefined) updatePayload.status = status;
    if (viewingAt !== undefined) updatePayload.viewing_at = viewingAt || null;
    if (notes !== undefined) updatePayload.notes = notes;
    if (unitId !== undefined) updatePayload.unit_id = unitId || null;

    const { data: updated, error } = await supabase
      .from('property_enquiries')
      .update(updatePayload)
      .eq('company_id', user.companyId)
      .eq('id', id)
      .select('*, properties:property_id(name), units:unit_id(label)')
      .single();

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, enquiry: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
};

