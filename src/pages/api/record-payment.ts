import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyTenancy } from '../../lib/realtime';
import { clearLiveCache, markFresh } from '../../data/portfolio';

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
    // The tenancy id comes from the client: it must belong to this company,
    // or the payment would land in another landlord's ledger.
    const { data: ownTenancy, error: tenancyError } = await supabase
      .from('tenancies')
      .select('id')
      .eq('company_id', companyId)
      .eq('id', tenancyId)
      .maybeSingle();
    if (tenancyError) throw tenancyError;
    if (!ownTenancy) {
      return new Response(JSON.stringify({ error: 'Tenancy not found' }), { status: 404 });
    }

    // Defaults are Nairobi time, like the rest of the ledger.
    const nairobiNow = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const paymentDate = date || nairobiNow.slice(0, 10);
    const paymentTime = time || nairobiNow.slice(11, 16);
    const paymentMethod = method === 'Bank' ? 'Bank' : 'M-Pesa';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || paymentDate > nairobiNow.slice(0, 10)) {
      return new Response(JSON.stringify({ error: "A payment can't be dated in the future." }), { status: 400 });
    }
    const amountKes = Math.round(Number(amount));
    if (!(amountKes > 0)) {
      return new Response(JSON.stringify({ error: 'Enter an amount above zero.' }), { status: 400 });
    }

    const { data: newPayment, error } = await supabase
      .from('payments')
      .insert({
        company_id: companyId,
        tenancy_id: tenancyId,
        amount: amountKes,
        date: paymentDate,
        time: paymentTime,
        method: paymentMethod,
        reference: reference.trim().toUpperCase(),
      })
      .select()
      .single();

    if (error) throw error;

    // The tenant's inbox, worded like a confirmed payment message
    // (review_payment_claim). The payment is saved either way: log only.
    const { error: notifErr } = await supabase.from('notifications').insert({
      company_id: companyId,
      tenancy_id: tenancyId,
      kind: 'general',
      title: 'Payment confirmed',
      body: `KES ${amountKes.toLocaleString('en-US')} (${newPayment.reference}) confirmed. Receipt ${newPayment.receipt_number} is ready in Payments.`,
    });
    if (notifErr) console.error('[record-payment] tenant notification not saved:', notifErr);

    clearLiveCache(companyId);
    markFresh(cookies);
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
