import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { validateBulkCsv, executeBulkImport } from '../../lib/bulk-import';
import { clearLiveCache, markFresh } from '../../data/portfolio';
import { notifyCompany } from '../../lib/realtime';

const MAX_CSV_BYTES = 1024 * 1024;
const MAX_ROWS = 500;

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
    // Refuse an oversized upload before reading it.
    if (Number(request.headers.get('content-length') ?? 0) > MAX_CSV_BYTES * 2) {
      return new Response(JSON.stringify({ error: 'That file is larger than 1 MB. Split it into smaller files and upload each one.' }), { status: 413 });
    }
    const body = await request.json();
    const { csvText, mode, defaultManagerId } = body;

    if (!csvText || typeof csvText !== 'string') {
      return new Response(JSON.stringify({ error: 'CSV data is required.' }), { status: 400 });
    }

    if (new TextEncoder().encode(csvText).length > MAX_CSV_BYTES) {
      return new Response(JSON.stringify({ error: 'That file is larger than 1 MB. Split it into smaller files and upload each one.' }), { status: 413 });
    }

    const validation = validateBulkCsv(csvText);
    if (validation.rows.length > MAX_ROWS) {
      return new Response(JSON.stringify({
        error: `That file has ${validation.rows.length} rows. Upload up to ${MAX_ROWS} rows at a time. Nothing was imported.`,
      }), { status: 400 });
    }

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
      // All or nothing: a row with an error must never be saved with a
      // default (0 balance, today's move-in) standing in for what the sheet said.
      if (!validation.valid || validation.rows.length === 0) {
        return new Response(JSON.stringify({
          error: 'Fix the rows listed below, then upload the file again. Nothing was imported.',
          errors: validation.errors,
        }), { status: 400 });
      }

      // The manager assigned to new properties must be an owner or manager of
      // this company, never an id from elsewhere.
      let managerId: string | undefined;
      if (defaultManagerId !== undefined && defaultManagerId !== null && defaultManagerId !== '') {
        if (typeof defaultManagerId !== 'string') {
          return new Response(JSON.stringify({ error: 'Choose a manager from your team.' }), { status: 400 });
        }
        const { data: manager, error: managerErr } = await supabase
          .from('staff')
          .select('id')
          .eq('company_id', user.companyId)
          .eq('id', defaultManagerId)
          .in('role', ['owner', 'manager'])
          .maybeSingle();
        if (managerErr) throw managerErr;
        if (!manager) {
          return new Response(JSON.stringify({ error: 'Choose a manager from your team. That person is not an owner or manager here.' }), { status: 400 });
        }
        managerId = manager.id;
      }

      const result = await executeBulkImport(supabase, user.companyId, validation.rows, managerId);

      // Anything written must show up, even when some rows failed.
      if (result.wroteAnything) {
        clearLiveCache(user.companyId);
        markFresh(cookies);
        notifyCompany(supabase, user.companyId, 'bulk_import');
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
    const message = errorMessage(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

