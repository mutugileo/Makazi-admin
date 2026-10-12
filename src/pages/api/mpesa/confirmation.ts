import type { APIRoute } from 'astro';
import { makeSupabaseClient } from '../../../lib/supabase';
import { clearLiveCache } from '../../../data/portfolio';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Safaricom Daraja C2B Confirmation Webhook Endpoint for PropAdmin
 * Idempotent, lean, sub-100ms response during peak 1st-5th rent week.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const supabase = makeSupabaseClient(cookies);
  if (!supabase) {
    return json({ ResultCode: 0, ResultDesc: 'Success' });
  }

  try {
    const payload = await request.json().catch(() => null);
    if (!payload?.TransID) {
      return json({ ResultCode: 0, ResultDesc: 'Missing payload' });
    }

    const transId = String(payload.TransID).trim().toUpperCase();
    const shortcode = String(payload.BusinessShortCode || '').trim();
    const billRef = String(payload.BillRefNumber || '').trim();
    const amount = Math.round(Number(payload.TransAmount) || 0);
    const msisdn = String(payload.MSISDN || '').trim();
    const transTime = String(payload.TransTime || '').trim();

    // 1. Idempotency Guard: prevent duplicate receipts on Safaricom retry
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('id, receipt_number')
      .eq('reference', transId)
      .maybeSingle();

    if (existingPayment) {
      return json({ ResultCode: 0, ResultDesc: 'Success (idempotent duplicate)' });
    }

    // 2. Resolve company
    const { data: companies } = await supabase
      .from('companies')
      .select('id, name, mpesa_paybill, settings');

    const company = (companies || []).find(
      (c) => c.mpesa_paybill === shortcode || c.settings?.daraja?.shortcode === shortcode,
    );

    if (!company) {
      return json({ ResultCode: 0, ResultDesc: 'Success' });
    }

    // 3. Format date and time
    let dateStr = new Date().toISOString().slice(0, 10);
    let timeStr = new Date().toTimeString().slice(0, 5);
    if (transTime.length >= 8) {
      dateStr = `${transTime.slice(0, 4)}-${transTime.slice(4, 6)}-${transTime.slice(6, 8)}`;
      if (transTime.length >= 12) {
        timeStr = `${transTime.slice(8, 10)}:${transTime.slice(10, 12)}`;
      }
    }

    // 4. Resolve tenancy
    const refParts = billRef.split('-');
    let matchedTenancy = null;
    if (refParts.length >= 2) {
      const prefix = refParts[0].toUpperCase();
      const unitLabel = refParts.slice(1).join('-').toUpperCase();

      const { data: prop } = await supabase
        .from('properties')
        .select('id')
        .eq('company_id', company.id)
        .eq('account_prefix', prefix)
        .maybeSingle();

      if (prop) {
        const { data: unit } = await supabase
          .from('units')
          .select('id')
          .eq('company_id', company.id)
          .eq('property_id', prop.id)
          .ilike('label', unitLabel)
          .maybeSingle();

        if (unit) {
          const { data: tenancy } = await supabase
            .from('tenancies')
            .select('id')
            .eq('company_id', company.id)
            .eq('unit_id', unit.id)
            .is('move_out', null)
            .maybeSingle();
          matchedTenancy = tenancy;
        }
      }
    }

    const receiptNumber =
      'RCT-' + dateStr.slice(2, 4) + dateStr.slice(5, 7) + '-' + Math.floor(1000 + Math.random() * 9000);

    if (matchedTenancy) {
      await supabase.from('payments').insert({
        company_id: company.id,
        receipt_number: receiptNumber,
        tenancy_id: matchedTenancy.id,
        amount,
        date: dateStr,
        time: timeStr,
        method: 'M-Pesa',
        reference: transId,
        simulated: false,
      });

      clearLiveCache(company.id);

      // Async audit log
      queueMicrotask(async () => {
        try {
          await supabase.from('audit_log').insert({
            company_id: company.id,
            action: 'mpesa_c2b_confirmed',
            target: receiptNumber,
            detail: { transId, amount, msisdn, billRef },
          });
        } catch {}
      });
    }

    return json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (err) {
    console.error('[c2b-confirmation] Error:', err);
    return json({ ResultCode: 0, ResultDesc: 'Success' });
  }
};
