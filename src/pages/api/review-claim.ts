import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
import { clearLiveCache } from '../../data/portfolio';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Errors raised by review_payment_claim carry a message meant for staff.
const STATUS_BY_CODE: Record<string, number> = { '22023': 400, P0002: 404, '55000': 409, '23505': 409 };

/**
 * Confirms a tenant's payment message (records the payment and issues a
 * receipt) or rejects it with a reason the tenant sees. Owner only; the
 * database function does both writes in one transaction.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (user.role !== 'owner') return json({ error: 'Only the owner can confirm payments.' }, 403);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = (await request.json()) ?? {};
    if (typeof body.claimId !== 'string' || (body.action !== 'confirm' && body.action !== 'reject')) {
      return json({ error: 'Choose a payment message to confirm or reject.' }, 400);
    }

    const { data, error } = await supabase.rpc('review_payment_claim', {
      p_company_id: user.companyId,
      p_claim_id: body.claimId,
      p_action: body.action,
      p_reviewer: user.name || user.email,
      p_reference: typeof body.reference === 'string' ? body.reference : null,
      p_amount: Number.isFinite(Number(body.amount)) && body.amount !== '' ? Math.round(Number(body.amount)) : null,
      p_date: typeof body.date === 'string' && body.date ? body.date : null,
      p_time: typeof body.time === 'string' && body.time ? body.time : null,
      p_method: typeof body.method === 'string' ? body.method : null,
      p_note: typeof body.note === 'string' ? body.note : null,
    });
    if (error) {
      const status = STATUS_BY_CODE[error.code ?? ''];
      if (status) return json({ error: error.message }, status);
      throw error;
    }

    clearLiveCache(user.companyId);
    await notifyTenancy(supabase, data.tenancyId, 'data_updated', { action: 'payment_claim_reviewed' });

    return json({ status: data.status, receiptNumber: data.receiptNumber ?? null });
  } catch (err: unknown) {
    console.error('[review-claim]', err);
    return json({ error: errorMessage(err, 'Could not review the payment message. Try again.') }, 500);
  }
};
