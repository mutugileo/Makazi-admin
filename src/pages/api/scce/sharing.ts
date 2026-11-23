import type { APIRoute } from 'astro';
import { errorMessage } from '../../../lib/errors';
import { makeSupabaseClient } from '../../../lib/supabase';
import { clearLiveCache } from '../../../data/portfolio';
import { scceSharingOf, type ScceSharing } from '../../../lib/scce/features';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * The owner turns SCCE sharing on or off. On means SCCE's nightly collector
 * receives this company's portfolio totals; off means it stops from the next
 * collection. Owner only.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (user.role !== 'owner') return json({ error: 'Only the owner can change SCCE sharing.' }, 403);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = (await request.json().catch(() => null)) ?? {};
    if (typeof body.enabled !== 'boolean') return json({ error: 'Choose whether to share with SCCE.' }, 400);

    const { data: current, error: readErr } = await supabase
      .from('companies')
      .select('settings')
      .eq('id', user.companyId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) return json({ error: 'Company not found' }, 404);

    const now = new Date().toISOString();
    const before = scceSharingOf(current);
    const scce: ScceSharing = body.enabled
      ? { enabled: true, enabledAt: before.enabled ? before.enabledAt : now, enabledBy: before.enabled ? before.enabledBy : user.email, disabledAt: null }
      : { ...before, enabled: false, disabledAt: before.enabled ? now : before.disabledAt };

    const { error } = await supabase
      .from('companies')
      .update({ settings: { ...current.settings, scce } })
      .eq('id', user.companyId);
    if (error) throw error;

    clearLiveCache(user.companyId);
    return json({ success: true, scce });
  } catch (err: unknown) {
    return json({ error: errorMessage(err) }, 500);
  }
};
