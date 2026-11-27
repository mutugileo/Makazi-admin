import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyCompany } from '../../lib/realtime';
import { clearLiveCache, markFresh } from '../../data/portfolio';
import { parseKenyanPhone } from '../../lib/tenant-auth';
import { getEntitlements, hasFeature, PROPERTY_PAYMENTS_LOCKED_MESSAGE } from '../../lib/entitlements';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const wholeNumber = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) ? n : null;
};

/**
 * Company details and billing rules from Settings. These are what tenants see
 * in the app: the name on every screen, the KRA PIN on receipts, the Paybill
 * and bank on Pay rent, and the due and grace days on their bill.
 *
 * Owner only. The ledger start month and the plan are not editable here;
 * per-property payment details need the property_payment_details feature.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (user.role !== 'owner') return json({ error: 'Only the owner can change settings.' }, 403);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = (await request.json()) ?? {};
    const text = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

    const name = text(body.name);
    if (name.length < 2 || name.length > 120) return json({ error: 'Enter the company name.' }, 400);

    const kraPin = text(body.kraPin).toUpperCase();
    if (!/^[AP]\d{9}[A-Z]$/.test(kraPin)) {
      return json({ error: 'KRA PIN must have 1 letter, 9 digits, and 1 letter (11 characters total).' }, 400);
    }

    const mpesaPaybill = text(body.mpesaPaybill).replace(/\s/g, '');
    if (!/^\d{5,7}$/.test(mpesaPaybill)) return json({ error: 'M-Pesa Paybill is 5 to 7 digits.' }, 400);

    const paybillAccountMode = body.paybillAccountMode === 'bank' ? 'bank' : 'unit';

    const bankName = text(body.bankName);
    if (bankName.length < 2 || bankName.length > 80) return json({ error: 'Enter the account name or bank.' }, 400);

    const bankAccount = text(body.bankAccount).replace(/[\s-]/g, '');
    if (!/^\d{6,20}$/.test(bankAccount)) return json({ error: 'Account number is 6 to 20 digits.' }, 400);

    const dueDay = wholeNumber(body.dueDay);
    const graceDay = wholeNumber(body.graceDay);
    if (dueDay === null || dueDay < 1 || dueDay > 28) return json({ error: 'Rent due day is between 1 and 28.' }, 400);
    if (graceDay === null || graceDay < dueDay || graceDay > 28) {
      return json({ error: `Grace period ends between day ${dueDay} and day 28.` }, 400);
    }

    const retention = wholeNumber(body.recordRetentionMonths);
    if (retention === null || retention < 1 || retention > 24) {
      return json({ error: "Keep former tenants' records for 1 to 24 months." }, 400);
    }

    // Per-property payment details: all checked before anything is written.
    interface PropertyPayment {
      propertyId: string;
      mpesaPaybill: string | null;
      bankName: string | null;
      bankAccount: string | null;
      pesalinkPhone: string | null;
    }
    const propertyPayments: PropertyPayment[] = [];
    if (body.propertyPayments !== undefined && body.propertyPayments !== null) {
      if (!Array.isArray(body.propertyPayments) || body.propertyPayments.length > 500) {
        return json({ error: 'Property payment details are not valid. Reload the page and try again.' }, 400);
      }
      if (body.propertyPayments.length > 0) {
        const entitlements = await getEntitlements(supabase, user.companyId, locals);
        if (!hasFeature(entitlements, 'property_payment_details')) {
          return json({ error: PROPERTY_PAYMENTS_LOCKED_MESSAGE }, 403);
        }
      }
      const seen = new Set<string>();
      for (const item of body.propertyPayments) {
        const propId = typeof item?.propertyId === 'string' ? item.propertyId.trim() : '';
        if (!propId || seen.has(propId)) continue;
        seen.add(propId);

        const rawPaybill = text(item.mpesaPaybill).replace(/\s/g, '');
        if (rawPaybill && !/^\d{5,7}$/.test(rawPaybill)) {
          return json({ error: 'Property M-Pesa Paybill must be 5 to 7 digits.' }, 400);
        }

        const rawBankName = text(item.bankName);
        if (rawBankName && (rawBankName.length < 2 || rawBankName.length > 80)) {
          return json({ error: 'Property bank name must be between 2 and 80 characters.' }, 400);
        }

        const rawBankAccount = text(item.bankAccount).replace(/[\s-]/g, '');
        if (rawBankAccount && !/^\d{6,20}$/.test(rawBankAccount)) {
          return json({ error: 'Property bank account must be 6 to 20 digits.' }, 400);
        }

        const rawPesalink = text(item.pesalinkPhone);
        let pesalinkPhone: string | null = null;
        if (rawPesalink) {
          const parsed = parseKenyanPhone(rawPesalink);
          if (!parsed) return json({ error: 'Property PesaLink phone must be a Safaricom or Airtel number.' }, 400);
          pesalinkPhone = parsed.local;
        }

        propertyPayments.push({
          propertyId: propId,
          mpesaPaybill: rawPaybill || null,
          bankName: rawBankName || null,
          bankAccount: rawBankAccount || null,
          pesalinkPhone,
        });
      }
    }

    const { data: current, error: readErr } = await supabase
      .from('companies')
      .select('settings')
      .eq('id', user.companyId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) return json({ error: 'Company not found' }, 404);

    // Deposit amounts for the bedroom counts the company already has.
    const existingSchedule = (current.settings?.depositSchedule ?? {}) as Record<string, number>;
    const depositSchedule: Record<string, number> = {};
    for (const beds of Object.keys(existingSchedule)) {
      const amount = wholeNumber(body.depositSchedule?.[beds]);
      if (amount === null || amount < 0 || amount > 10_000_000) {
        return json({ error: 'Deposits are whole shillings, 0 or more.' }, 400);
      }
      depositSchedule[beds] = amount;
    }

    // Every property sent must be one of this company's.
    if (propertyPayments.length > 0) {
      const { data: owned, error: ownedErr } = await supabase
        .from('properties')
        .select('id')
        .eq('company_id', user.companyId)
        .in('id', propertyPayments.map((p) => p.propertyId));
      if (ownedErr) throw ownedErr;
      const ownedIds = new Set((owned ?? []).map((p) => p.id as string));
      if (propertyPayments.some((p) => !ownedIds.has(p.propertyId))) {
        return json({ error: 'One of those properties was not found. Reload the page and try again.' }, 404);
      }
    }

    // The brand theme is set only by Codzure in the super-admin portal. Any
    // `theme` sent here is ignored, so the stored theme stays as it is.
    const settings = {
      ...current.settings,
      dueDay,
      graceDay,
      depositSchedule,
      recordRetentionMonths: retention,
      paybillAccountMode,
    };
    if (propertyPayments.length > 0) {
      const updatedAt = new Date().toISOString();
      settings.propertyPayments = { ...(current.settings?.propertyPayments ?? {}) };
      for (const p of propertyPayments) {
        settings.propertyPayments[p.propertyId] = {
          mpesaPaybill: p.mpesaPaybill,
          bankName: p.bankName,
          bankAccount: p.bankAccount,
          pesalinkPhone: p.pesalinkPhone,
          updatedAt,
        };
      }
    }

    const { error } = await supabase
      .from('companies')
      .update({ name, kra_pin: kraPin, mpesa_paybill: mpesaPaybill, bank_name: bankName, bank_account: bankAccount, settings })
      .eq('id', user.companyId);
    if (error) throw error;

    for (const p of propertyPayments) {
      const { error: propErr } = await supabase
        .from('properties')
        .update({ mpesa_paybill: p.mpesaPaybill, bank_name: p.bankName, bank_account: p.bankAccount })
        .eq('id', p.propertyId)
        .eq('company_id', user.companyId);
      if (propErr) {
        // The company details were saved: drop the stale cache, then say what failed.
        clearLiveCache(user.companyId);
        markFresh(cookies);
        console.error('[update-settings] property payment details not saved:', propErr);
        return json({ error: errorMessage(propErr, "Company details saved, but a property's payment details didn't. Try again.") }, 500);
      }
    }

    clearLiveCache(user.companyId);
    markFresh(cookies);
    // Every tenant's app refetches and shows the new details.
    await notifyCompany(supabase, user.companyId, 'data_updated', { action: 'settings_updated' });

    return json({ success: true });
  } catch (err: unknown) {
    return json({ error: errorMessage(err) }, 500);
  }
};
