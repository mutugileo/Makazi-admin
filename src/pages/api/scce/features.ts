import type { APIRoute } from 'astro';
import { SCCE_EXPORT_SECRET } from 'astro:env/server';
import { addMonths, monthOf, type Month } from '../../../lib/billing';
import { makeServiceRoleClient } from '../../../lib/supabase';
import { fetchSeedFromSupabase } from '../../../lib/supabase-data';
import { verifySignature } from '../../../lib/scce/signature';
import { FEATURES_SCHEMA_VERSION, portfolioMonths, scceSharingOf } from '../../../lib/scce/features';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 24;

/**
 * Portfolio totals for SCCE's nightly collector: every landlord whose owner
 * turned on sharing in Settings, for closed months `from`..`to`.
 *
 * GET /api/scce/features?from=2025-10&to=2026-09
 * Headers: X-SCCE-Timestamp (unix seconds), X-SCCE-Signature
 * (hex HMAC-SHA256 of "<timestamp>.GET.<path and query>").
 *
 * Company-level totals only; no tenant row leaves Makazi.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const secret = SCCE_EXPORT_SECRET || process.env.SCCE_EXPORT_SECRET;
  if (!secret) return json({ error: 'SCCE export is off: SCCE_EXPORT_SECRET is not set.' }, 503);

  const check = verifySignature(secret, request.headers, 'GET', url.pathname + url.search);
  if (!check.ok) return json({ error: check.reason }, 401);

  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!MONTH.test(from) || !MONTH.test(to)) return json({ error: 'from and to are months, e.g. 2026-09.' }, 400);
  if (from > to) return json({ error: 'from must not be after to.' }, 400);
  if (addMonths(from, MAX_MONTHS - 1) < to) return json({ error: `Ask for ${MAX_MONTHS} months or fewer.` }, 400);

  // Only closed months: this month's bills are still being paid.
  const thisMonth: Month = monthOf(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10));
  if (to >= thisMonth) return json({ error: `to must be before ${thisMonth}; only closed months are exported.` }, 400);

  const supabase = makeServiceRoleClient();
  if (!supabase) return json({ error: 'SCCE export needs SUPABASE_SERVICE_ROLE_KEY.' }, 503);

  const { data: companies, error } = await supabase.from('companies').select('id, name, kra_pin, settings');
  if (error) return json({ error: 'Could not read companies.' }, 502);

  const sharing = (companies ?? []).filter((c) => scceSharingOf(c).enabled);
  const subjects = [];
  for (const c of sharing) {
    const consent = scceSharingOf(c);
    try {
      const seed = await fetchSeedFromSupabase(supabase, c.id);
      subjects.push({
        sourceSubjectId: c.id,
        kind: 'landlord',
        displayName: c.name,
        kraPin: c.kra_pin || null,
        ledgerStartMonth: c.settings?.ledgerStartMonth ?? null,
        consent: { enabledAt: consent.enabledAt, enabledBy: consent.enabledBy },
        months: portfolioMonths(seed, c.id, from, to),
      });
    } catch (err) {
      console.error(`[scce-export] ${c.id}:`, err);
      // One company's failure must not hold back the rest.
      subjects.push({ sourceSubjectId: c.id, kind: 'landlord', error: 'Could not build this company\'s totals; try again.' });
    }
  }

  return json({
    source: 'makazi',
    schemaVersion: FEATURES_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    from,
    to,
    subjects,
  });
};
