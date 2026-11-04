import type { APIRoute } from 'astro';
import { makeSupabaseClient } from '../../lib/supabase';
import { validateBulkCsv, executeBulkImport } from '../../lib/bulk-import';
import { clearLiveCache } from '../../data/portfolio';
import { notifyCompany } from '../../lib/realtime';

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Database not configured' }), { status: 500 });
  }

  try {
    const body = await request.json();
    const { csvText, mode, defaultManagerId } = body;

    if (!csvText || typeof csvText !== 'string') {
      return new Response(JSON.stringify({ error: 'CSV data is required.' }), { status: 400 });
    }

    const validation = validateBulkCsv(csvText);

    if (mode === 'validate') {
      return new Response(JSON.stringify({
        ok: true,
        valid: validation.valid,
        summary: validation.summary,
        errors: validation.errors,
        warnings: validation.warnings,
        sampleRows: validation.rows.slice(0, 5),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'commit') {
      if (!validation.valid && validation.rows.length === 0) {
        return new Response(JSON.stringify({
          error: 'Cannot import invalid CSV file. Please fix errors first.',
          errors: validation.errors,
        }), { status: 400 });
      }

      const result = await executeBulkImport(supabase, user.companyId, validation.rows, defaultManagerId);

      if (result.success) {
        clearLiveCache(user.companyId);
        notifyCompany(user.companyId);
      }

      return new Response(JSON.stringify({
        ok: result.success,
        result,
      }), {
        status: result.success ? 200 : 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid mode. Use 'validate' or 'commit'." }), { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

