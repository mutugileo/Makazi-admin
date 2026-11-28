import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
import { clearLiveCache } from '../../data/portfolio';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const STATUS_BY_CODE: Record<string, number> = { '22023': 400, P0002: 404, '55000': 409 };

/**
 * Countersigns or declines a tenant's Notice to Vacate.
 * Owner or manager only; strictly scoped to user.companyId.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (user.role !== 'owner' && user.role !== 'manager') {
    return json({ error: 'Only owners and managers can review notices.' }, 403);
  }

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = (await request.json()) ?? {};
    if (typeof body.noticeId !== 'string' || (body.action !== 'countersign' && body.action !== 'decline')) {
      return json({ error: 'Choose a notice to countersign or decline.' }, 400);
    }

    const { data, error } = await supabase.rpc('review_vacation_notice', {
      p_company_id: user.companyId,
      p_notice_id: body.noticeId,
      p_action: body.action,
      p_signer: user.name || user.email,
      p_signature_type: typeof body.signatureType === 'string' ? body.signatureType : null,
      p_signature_data: typeof body.signatureData === 'string' ? body.signatureData : null,
      p_note: typeof body.note === 'string' ? body.note : null,
    });

    if (error) {
      const status = STATUS_BY_CODE[error.code ?? ''];
      if (status) return json({ error: error.message }, status);
      throw error;
    }

    clearLiveCache(user.companyId);
    await notifyTenancy(supabase, data.tenancyId, 'data_updated', { action: 'vacation_notice_reviewed' });

    return json({ status: data.status, vacatingDate: data.vacatingDate ?? null });
  } catch (err: unknown) {
    console.error('[review-vacation-notice]', err);
    return json({ error: errorMessage(err, 'Could not review the notice. Try again.') }, 500);
  }
};
