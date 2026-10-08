import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
import { paymentReminder } from '../../lib/reminders';
import { clearLiveCache, getPortfolio } from '../../data/portfolio';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sends an in-app payment reminder to every tenant who owes money now (or to
 * the ones listed in tenancyIds). Who owes what is worked out here from the
 * database, never taken from the browser. A tenant reminded in the last 24
 * hours is skipped, so a double click can't send twice.
 *
 * Body: { tenancyIds?: string[] }
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = (await request.json().catch(() => ({}))) ?? {};
    const only = Array.isArray(body.tenancyIds)
      ? new Set(body.tenancyIds.filter((id: unknown): id is string => typeof id === 'string'))
      : null;

    // Fresh numbers, not a cached page's.
    clearLiveCache(user.companyId);
    const { arrears, company, asOf } = await getPortfolio(user.companyId, cookies);
    const owing = arrears.filter((t) => t.balance > 0 && (!only || only.has(t.tenancy.id)));
    if (!owing.length) return json({ sent: 0, skipped: 0 });

    const { data: recent, error: recentErr } = await supabase
      .from('notifications')
      .select('tenancy_id')
      .eq('company_id', user.companyId)
      .eq('kind', 'payment_reminder')
      .in('tenancy_id', owing.map((t) => t.tenancy.id))
      .gte('created_at', new Date(Date.now() - DAY_MS).toISOString());
    if (recentErr) throw recentErr;
    const remindedToday = new Set((recent ?? []).map((r) => r.tenancy_id as string));

    const toSend = owing.filter((t) => !remindedToday.has(t.tenancy.id));
    if (toSend.length) {
      const rows = toSend.map((t) => ({
        company_id: user.companyId,
        tenancy_id: t.tenancy.id,
        kind: 'payment_reminder',
        ...paymentReminder({
          tenantName: t.tenant.name,
          balance: t.balance,
          accountNumber: t.accountNumber,
          companyName: company.name,
          mpesaPaybill: company.mpesaPaybill,
          graceDay: company.settings.graceDay,
          asOf,
        }),
      }));
      const { error } = await supabase.from('notifications').insert(rows);
      if (error) throw error;

      // Ids only (realtime.ts): each app refetches its own notifications.
      await Promise.allSettled(
        toSend.map((t) => notifyTenancy(supabase, t.tenancy.id, 'data_updated', { action: 'notification' })),
      );
    }

    return json({ sent: toSend.length, skipped: owing.length - toSend.length });
  } catch (err: unknown) {
    return json({ error: errorMessage(err) }, 500);
  }
};
