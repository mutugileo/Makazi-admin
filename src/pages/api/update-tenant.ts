import type { APIRoute } from 'astro';
import { cycleOf } from '../../lib/billing';
import { errorMessage } from '../../lib/errors';
import { makeSupabaseClient } from '../../lib/supabase';
import { clearLiveCache, markFresh } from '../../data/portfolio';
import { notifyTenancy, notifyCompany } from '../../lib/realtime';
import { parseKenyanPhone, phoneSpellings, type KenyanPhone } from '../../lib/tenant-auth';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** YYYY-MM-DD and a day that exists (2026-02-30 is refused). */
const isRealDate = (v: unknown): v is string =>
  typeof v === 'string' && ISO_DATE.test(v) && !isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabaseClient(cookies);
  if (!supabase) return json({ error: 'Database not configured' }, 500);

  try {
    const body = await request.json();
    const { tenancyId, tenantId, name, phone: rawPhone, email, rent, deposit, moveIn, moveInRent, leaseEnd } = body;

    if (!tenancyId || !tenantId || typeof name !== 'string' || !name.trim() || !rawPhone || !rent) {
      return json({ error: 'Missing required tenant or tenancy fields.' }, 400);
    }

    const companyId = user.companyId;

    // Validate phone
    const parsedPhone = parseKenyanPhone(rawPhone);
    if (!parsedPhone) {
      return json({ error: 'Enter a valid Kenyan mobile number (07... or 01...).' }, 400);
    }

    const rentKes = Math.round(Number(rent));
    const depositKes = deposit !== undefined && deposit !== null && deposit !== '' ? Math.round(Number(deposit)) : undefined;
    if (!(rentKes > 0)) {
      return json({ error: 'Monthly rent must be greater than zero.' }, 400);
    }
    if (depositKes !== undefined && !(depositKes >= 0)) {
      return json({ error: 'Deposit must be 0 or more.' }, 400);
    }
    const moveInRentKes = moveInRent === '' || moveInRent == null ? NaN : Math.round(Number(moveInRent));
    if (!(moveInRentKes >= 0 && moveInRentKes <= rentKes * 2)) {
      return json({ error: 'Move-in rent must be from 0 up to twice the monthly rent.' }, 400);
    }
    if (moveIn && !isRealDate(moveIn)) return json({ error: 'Move-in must be a valid date.' }, 400);
    if (leaseEnd && !isRealDate(leaseEnd)) return json({ error: 'Lease end must be a valid date.' }, 400);
    if (moveIn && leaseEnd && leaseEnd < moveIn) {
      return json({ error: 'Lease end must be after the move-in date.' }, 400);
    }

    // Verify tenant and tenancy belong to this company
    const { data: currentTenancy, error: tenancySearchErr } = await supabase
      .from('tenancies')
      .select('id, tenant_id, rent, deposit, move_in, opening_balance_month, companies(settings)')
      .eq('company_id', companyId)
      .eq('id', tenancyId)
      .maybeSingle();
    if (tenancySearchErr) throw tenancySearchErr;
    if (!currentTenancy) {
      return json({ error: 'Tenancy record not found for your company.' }, 404);
    }
    // The tenant edited must be this tenancy's tenant, never another one.
    if (tenantId !== currentTenancy.tenant_id) {
      return json({ error: 'That tenant does not belong to this tenancy. Reload the page and try again.' }, 400);
    }

    // One rent figure prices every bill of the tenancy (there is no rent
    // history yet), so changing rent, deposit or move-in once earlier cycles
    // are billed would silently rewrite them. Corrections are allowed only
    // while the current cycle is the first one billed, under the old move-in
    // date and under the new one.
    const moneyChanged =
      rentKes !== currentTenancy.rent ||
      (depositKes !== undefined && depositKes !== currentTenancy.deposit) ||
      (Boolean(moveIn) && moveIn !== currentTenancy.move_in);
    if (moneyChanged) {
      const companySettings = (currentTenancy as { companies?: { settings?: { ledgerStartMonth?: string } } }).companies?.settings;
      const companyStart = companySettings?.ledgerStartMonth ?? '0000-00';
      const own = currentTenancy.opening_balance_month as string | null;
      const firstBilledFor = (moveInDate: string) => [companyStart, own ?? '', cycleOf(moveInDate)].sort().pop()!;
      const currentCycle = cycleOf(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10));
      const earlierBilled =
        firstBilledFor(currentTenancy.move_in as string) < currentCycle || (Boolean(moveIn) && firstBilledFor(moveIn) < currentCycle);
      if (earlierBilled) {
        return json({
          error: 'Rent, deposit and move-in date can\'t be changed once earlier months are billed: it would rewrite those bills. Name, phone, email and lease end can still be edited.',
        }, 409);
      }
    }

    const { data: currentTenant, error: tenantReadErr } = await supabase
      .from('tenants')
      .select('id, phone, auth_user_id')
      .eq('company_id', companyId)
      .eq('id', tenantId)
      .maybeSingle();
    if (tenantReadErr) throw tenantReadErr;
    if (!currentTenant) return json({ error: 'Tenant not found for your company.' }, 404);

    const oldPhone = parseKenyanPhone(String(currentTenant.phone ?? ''));
    const phoneChanged = oldPhone?.digits !== parsedPhone.digits;

    if (phoneChanged) {
      // One tenant per phone per company: say so before touching the login.
      const { data: clash, error: clashErr } = await supabase
        .from('tenants')
        .select('id')
        .eq('company_id', companyId)
        .in('phone', phoneSpellings(parsedPhone))
        .neq('id', tenantId)
        .limit(1);
      if (clashErr) throw clashErr;
      if (clash && clash.length > 0) {
        return json({ error: 'Another tenant already has this phone number in your company.' }, 409);
      }
    }

    // 1. The app login follows the phone: update it first, so the tenant row
    //    never names a phone the tenant can't sign in with.
    const authUserId = currentTenant.auth_user_id as string | null;
    let authMovedFrom: KenyanPhone | null = null;
    let previousMetadata: Record<string, unknown> = {};
    if (authUserId) {
      const { data: authUser, error: getErr } = await supabase.auth.admin.getUserById(authUserId);
      if (getErr && phoneChanged) {
        console.error('[update-tenant] login lookup failed:', getErr);
        return json({ error: "Couldn't update the tenant's app login, so nothing was changed. Try again." }, 502);
      }
      previousMetadata = authUser?.user?.user_metadata ?? {};
      const metadata = {
        ...previousMetadata,
        name: name.trim(),
        phone: parsedPhone.intl,
        company_id: companyId,
      };
      const { error: authErr } = await supabase.auth.admin.updateUserById(
        authUserId,
        phoneChanged ? { email: parsedPhone.authEmail, email_confirm: true, user_metadata: metadata } : { user_metadata: metadata },
      );
      if (authErr) {
        console.error('[update-tenant] login update failed:', authErr);
        if (phoneChanged) {
          const taken = authErr.code === 'email_exists' || /already/i.test(authErr.message ?? '');
          return json({
            error: taken
              ? 'That phone number already has a Makazi app login. Nothing was changed.'
              : "Couldn't move the tenant's app login to the new number, so nothing was changed. Try again.",
          }, taken ? 409 : 502);
        }
        // Same phone: only the name hint in the login changed; the record still saves.
      } else if (phoneChanged) {
        authMovedFrom = oldPhone;
      }
    }

    // 2. Update tenant personal info
    const { error: tenantErr } = await supabase
      .from('tenants')
      .update({
        name: name.trim(),
        phone: parsedPhone.local,
        email: (email || '').trim(),
      })
      .eq('company_id', companyId)
      .eq('id', tenantId);

    if (tenantErr) {
      // Put the login back on the old number so the tenant can still sign in.
      if (authUserId && authMovedFrom) {
        const { error: revertErr } = await supabase.auth.admin.updateUserById(authUserId, {
          email: authMovedFrom.authEmail,
          email_confirm: true,
          user_metadata: previousMetadata,
        });
        if (revertErr) console.error('[update-tenant] login revert failed:', revertErr);
      }
      if (tenantErr.code === '23505') {
        return json({ error: 'Another tenant already has this phone number in your company.' }, 409);
      }
      return json({ error: errorMessage(tenantErr, 'Couldn\'t save the tenant. Try again.') }, 500);
    }

    // 3. Update tenancy financial & lease details
    const tenancyUpdates: Record<string, unknown> = {
      rent: rentKes,
      move_in_rent: moveInRentKes,
    };
    if (depositKes !== undefined) tenancyUpdates.deposit = depositKes;
    if (moveIn) tenancyUpdates.move_in = moveIn;
    if (leaseEnd) tenancyUpdates.lease_end = leaseEnd;

    const { error: tenancyUpdateErr } = await supabase
      .from('tenancies')
      .update(tenancyUpdates)
      .eq('company_id', companyId)
      .eq('id', tenancyId);

    if (tenancyUpdateErr) {
      // The tenant's details above were saved: don't leave the cache showing the old ones.
      clearLiveCache(companyId);
      markFresh(cookies);
      return json({ error: errorMessage(tenancyUpdateErr, 'Tenant details saved, but the tenancy didn\'t. Try again.') }, 500);
    }

    // 3. Clear live cache & broadcast realtime update
    clearLiveCache(companyId);
    markFresh(cookies);
    await notifyTenancy(supabase, tenancyId, 'data_updated');
    await notifyCompany(supabase, companyId, 'data_updated');

    return json({ ok: true, message: 'Tenant details successfully updated.' });
  } catch (err: unknown) {
    return json({ error: errorMessage(err) }, 500);
  }
};
