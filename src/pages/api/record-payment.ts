import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
import { clearLiveCache } from '../../data/portfolio';

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
    const { tenancyId, amount, date, time, method, reference } = body;

    if (!tenancyId || !amount || !reference) {
      return new Response(JSON.stringify({ error: 'Missing required payment details' }), { status: 400 });
    }

    const companyId = user.companyId;
    // Defaults are Nairobi time, like the rest of the ledger.
    const nairobiNow = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const paymentDate = date || nairobiNow.slice(0, 10);
    const paymentTime = time || nairobiNow.slice(11, 16);
    const paymentMethod = method === 'Bank' ? 'Bank' : 'M-Pesa';

    const { data: newPayment, error } = await supabase
      .from('payments')
      .insert({
        company_id: companyId,
        tenancy_id: tenancyId,
        amount: Math.round(Number(amount)),
        date: paymentDate,
        time: paymentTime,
        method: paymentMethod,
        reference: reference.trim().toUpperCase(),
      })
      .select()
      .single();

    if (error) throw error;

    clearLiveCache(companyId);
    await notifyTenancy(supabase, tenancyId, 'data_updated', { action: 'payment_recorded' });

    return new Response(
      JSON.stringify({
        success: true,
        receiptNumber: newPayment.receipt_number,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const message = errorMessage(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
