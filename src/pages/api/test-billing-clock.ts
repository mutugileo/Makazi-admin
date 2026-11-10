import type { APIRoute } from 'astro';
import { addMonths, monthOf } from '../../lib/billing';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyCompany } from '../../lib/realtime';
import { clearLiveCache } from '../../data/portfolio';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Test-only billing clock. Moves the date the ledger is built as at, so the
 * next month's rent appears for every tenant of this company, in this portal
 * and in the tenant app. Reset returns to today.
 *
 * Off unless MAKAZI_TEST_BILLING=true. Owner only.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  if (process.env.MAKAZI_TEST_BILLING !== 'true') return json({ error: 'Not found' }, 404);

  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (user.role !== 'owner') return json({ error: 'Only the owner can use the test billing clock.' }, 403);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = (await request.json()) ?? {};
    const companyId = user.companyId;

    const { data: row, error: readError } = await supabase
      .from('companies')
      .select('settings')
      .eq('id', companyId)
      .single();
    if (readError || !row) return json({ error: 'Company not found' }, 404);

    const settings = { ...(row.settings ?? {}) } as Record<string, unknown>;
    const today = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // Nairobi
    const current = typeof settings.testAsOf === 'string' ? settings.testAsOf : today;

    if (body.action === 'advance') {
      settings.testAsOf = `${addMonths(monthOf(current), 1)}-01`;
    } else if (body.action === 'reset') {
      delete settings.testAsOf;
    } else {
      return json({ error: 'Unknown action.' }, 400);
    }

    const { error: writeError } = await supabase
      .from('companies')
      .update({ settings })
      .eq('id', companyId)
      .select('id')
      .single();
    if (writeError) return json({ error: errorMessage(writeError) }, 500);

    clearLiveCache(companyId);
    await notifyCompany(supabase, companyId, 'data_updated', { action: 'test_billing_clock' });

    return json({ testAsOf: typeof settings.testAsOf === 'string' ? settings.testAsOf : null });
  } catch (err) {
    return json({ error: errorMessage(err) }, 500);
  }
};
