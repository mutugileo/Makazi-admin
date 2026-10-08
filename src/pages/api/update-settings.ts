import type { APIRoute } from 'astro';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { notifyCompany } from '../../lib/realtime';
import { clearLiveCache } from '../../data/portfolio';

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
 * Owner only. The ledger start month and the plan are not editable here.
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
      return json({ error: 'KRA PIN is a letter, 9 digits and a letter, e.g. P051234567X.' }, 400);
    }

    const mpesaPaybill = text(body.mpesaPaybill).replace(/\s/g, '');
    if (!/^\d{5,7}$/.test(mpesaPaybill)) return json({ error: 'M-Pesa Paybill is 5 to 7 digits.' }, 400);

    const bankName = text(body.bankName);
    if (bankName.length < 2 || bankName.length > 80) return json({ error: 'Enter the bank and branch.' }, 400);

    const bankAccount = text(body.bankAccount).replace(/[\s-]/g, '');
    if (!/^\d{6,20}$/.test(bankAccount)) return json({ error: 'Bank account is 6 to 20 digits.' }, 400);

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

    const settings = {
      ...current.settings,
      dueDay,
      graceDay,
      depositSchedule,
      recordRetentionMonths: retention,
    };

    const { error } = await supabase
      .from('companies')
      .update({ name, kra_pin: kraPin, mpesa_paybill: mpesaPaybill, bank_name: bankName, bank_account: bankAccount, settings })
      .eq('id', user.companyId);
    if (error) throw error;

    clearLiveCache(user.companyId);
    // Every tenant's app refetches and shows the new details.
    await notifyCompany(supabase, user.companyId, 'data_updated', { action: 'settings_updated' });

    return json({ success: true });
  } catch (err: unknown) {
    return json({ error: errorMessage(err) }, 500);
  }
};
