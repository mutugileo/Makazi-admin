// End-to-end check against the live Supabase project and a running admin.
// Creates a throwaway tenant (0700 000 999) on a vacant unit, exercises the
// admin and the tenant's database access (the app's queries, as the tenant,
// through RLS), then removes everything it created and restores the company's
// counters and the property's rates.
//
//   npm run build && PORT=4399 npm start          (in one terminal)
//   E2E_ADMIN_PASSWORD=... npm run e2e:live        (in another)
//
// Needs a vacant unit at Kilimani Heights. Writes to the real database.
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:4399';
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };
if (!ADMIN.password) throw new Error('Set E2E_ADMIN_PASSWORD');
const PHONE = '0700000999';
const EMAIL = '254700000999@tenant.makazi.app';
const SEED_NAMES = ['Riverside Court', 'Mvuli Gardens', 'Ngong Road', 'David Mwangi', 'Savanna', 'Milimani'];

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const newTenantClient = () => createClient(process.env.SUPABASE_URL, anonKey, { auth: { persistSession: false } });

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name} ${detail}`); }
}

// ---- admin HTTP session
let cookie = '';
async function http(path, { method = 'GET', json, form } = {}) {
  const headers = { Origin: BASE, Cookie: cookie };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  const res = await fetch(BASE + path, { method, headers, body, redirect: 'manual' });
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const [pair] = c.split(';');
    const [name] = pair.split('=');
    cookie = cookie.split('; ').filter((x) => x && !x.startsWith(name + '=')).concat(pair).join('; ');
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, text, data };
}

// ---- snapshot for restore
const { data: companyBefore } = await svc.from('companies').select('sequences').eq('id', 'harborridge').single();
const { data: propBefore } = await svc.from('properties').select('water_rate,garbage_fee,rate_history').eq('id', 'kilimani-heights').single();
const created = { tenancyId: null, tenantId: null, authUserId: null, unitId: null };

try {
  console.log('Admin pages (live data only)');
  const login = await http('/login', { method: 'POST', form: ADMIN });
  check('admin signs in', login.status === 303, `status ${login.status}`);
  check('/leases is hidden (feature switched off)', (await http('/leases')).status === 404);
  for (const page of ['/', '/properties', '/tenants', '/bills', '/payments', '/arrears', '/maintenance', '/messages', '/reports', '/settings']) {
    const r = await http(page);
    const text = r.text.replace(/<[^>]+>/g, ' ');
    const seedHits = SEED_NAMES.filter((n) => text.includes(n));
    check(`${page} renders live data`, r.status === 200 && text.includes('Kilimani Heights') && seedHits.length === 0,
      `status ${r.status} seed=${seedHits.join(',')}`);
  }

  console.log('Onboarding');
  const { data: units } = await svc.from('units').select('id').eq('property_id', 'kilimani-heights');
  const { data: current } = await svc.from('tenancies').select('unit_id').is('move_out', null);
  created.unitId = units.map((u) => u.id).find((id) => !current.some((t) => t.unit_id === id));
  check('a vacant unit exists for the test', Boolean(created.unitId));
  const bad = await http('/api/onboard-tenant', { method: 'POST', json: { name: 'E2E', phone: '12345', unitId: created.unitId, rent: 1000, moveIn: '2026-10-07' } });
  check('rejects an invalid phone', bad.status === 400, `status ${bad.status}`);
  const occupied = current[0]?.unit_id;
  if (occupied) {
    const r = await http('/api/onboard-tenant', { method: 'POST', json: { name: 'E2E Test', phone: PHONE, unitId: occupied, rent: 1000, moveIn: '2026-10-07' } });
    check('refuses an occupied unit (409) and leaves no tenant behind', r.status === 409 &&
      !(await svc.from('tenants').select('id').eq('phone', PHONE)).data.length, `status ${r.status} ${r.text.slice(0, 120)}`);
  }
  const onboard = await http('/api/onboard-tenant', { method: 'POST', json: {
    name: 'E2E Test Tenant', phone: PHONE, email: '', unitId: created.unitId, rent: 20000, deposit: 25000,
    moveIn: '2026-10-07', openingReading: 5, leaseTerm: 12 } });
  check('onboards the tenant', onboard.status === 200 && onboard.data?.temporaryPassword, onboard.text.slice(0, 200));
  created.tenancyId = onboard.data?.tenancyId;
  created.tenantId = onboard.data?.tenantId;
  const otp = onboard.data?.temporaryPassword;

  console.log('Tenant sign-in with the one-time password');
  const tenant = newTenantClient();
  const signIn = await tenant.auth.signInWithPassword({ email: EMAIL, password: otp });
  created.authUserId = signIn.data.user?.id ?? null;
  check('tenant signs in', Boolean(signIn.data.user), signIn.error?.message);
  const status1 = await tenant.rpc('account_status');
  check('account_status says change password', status1.data?.mustChangePassword === true, JSON.stringify(status1.data ?? status1.error));
  const hidden = await tenant.from('tenancies').select('id');
  check('data hidden while on a one-time password', hidden.data?.length === 0, JSON.stringify(hidden.data ?? hidden.error));
  const updated = await tenant.auth.updateUser({ password: 'E2e-own-password-2026', data: { is_temporary: false } });
  check('tenant sets own password', !updated.error, updated.error?.message);
  const completed = await tenant.rpc('complete_password_change');
  check('complete_password_change clears the gate', completed.data === true, JSON.stringify(completed));
  const status2 = await tenant.rpc('account_status');
  check('account_status is clear', status2.data?.mustChangePassword === false, JSON.stringify(status2.data));

  console.log("Tenant reads (the app's queries, through RLS)");
  const uid = created.authUserId;
  const tRows = (await tenant.from('tenants').select('*').eq('auth_user_id', uid)).data ?? [];
  check('sees own tenant row only', tRows.length === 1 && tRows[0].id === created.tenantId);
  const allTenants = (await tenant.from('tenants').select('id')).data ?? [];
  check("can't see other tenants", allTenants.length === 1, `saw ${allTenants.length}`);
  const tcy = (await tenant.from('tenancies').select('*').in('tenant_id', [created.tenantId])).data ?? [];
  check('sees own tenancy', tcy.length === 1 && tcy[0].id === created.tenancyId);
  const allTcy = (await tenant.from('tenancies').select('id')).data ?? [];
  check("can't see other tenancies", allTcy.length === 1, `saw ${allTcy.length}`);
  for (const [table, q] of [
    ['companies', tenant.from('companies').select('*').eq('id', 'harborridge')],
    ['units', tenant.from('units').select('*').eq('company_id', 'harborridge').eq('id', created.unitId)],
    ['properties', tenant.from('properties').select('*').eq('company_id', 'harborridge').eq('id', 'kilimani-heights')],
    ['staff (manager)', tenant.from('staff').select('*').eq('company_id', 'harborridge').eq('id', 's-owner')],
    ['meter_readings', tenant.from('meter_readings').select('*').eq('company_id', 'harborridge').eq('unit_id', created.unitId)],
  ]) {
    const r = await q;
    check(`reads ${table}`, !r.error && r.data.length >= 1, r.error?.message ?? `${r.data.length} rows`);
  }
  const otherUnits = (await tenant.from('units').select('id')).data ?? [];
  check("sees only their own unit", otherUnits.length === 1, `saw ${otherUnits.length}`);

  console.log('Tenant writes');
  const ticket = await tenant.from('repair_tickets').insert({ company_id: 'harborridge', tenancy_id: created.tenancyId, unit_id: created.unitId,
    category: 'plumbing', title: 'E2E leak', description: 'E2E test ticket', has_photo: false }).select().single();
  check('files a repair request (database numbers it)', !ticket.error && /^MT-\d+$/.test(ticket.data.id), ticket.error?.message ?? ticket.data.id);
  const msg = await tenant.from('messages').insert({ company_id: 'harborridge', tenancy_id: created.tenancyId, sender: 'tenant', body: 'E2E hello' }).select().single();
  check('sends a message', !msg.error, msg.error?.message);
  const pay = await tenant.from('payments').insert({ company_id: 'harborridge', tenancy_id: created.tenancyId, amount: 1, date: '2026-10-07', time: '10:00', method: 'M-Pesa', reference: 'E2EFAKE01' });
  check("can't write a payment", Boolean(pay.error), 'insert was accepted');
  const spoof = await tenant.from('messages').insert({ company_id: 'harborridge', tenancy_id: created.tenancyId, sender: 'staff', body: 'spoof' });
  check("can't post as staff", Boolean(spoof.error));

  console.log('Realtime nudges (no message text on the wire)');
  const received = [];
  const channel = newTenantClient().channel(`makazi:tenancy:${created.tenancyId}`)
    .on('broadcast', { event: '*' }, (m) => received.push(m));
  await new Promise((resolve) => channel.subscribe((s) => s === 'SUBSCRIBED' && resolve()));
  const sent = await http('/api/send-message', { method: 'POST', json: { tenancyId: created.tenancyId, body: 'E2E reply from the manager' } });
  check('admin replies', sent.status === 200, sent.text.slice(0, 120));
  const paid = await http('/api/record-payment', { method: 'POST', json: { tenancyId: created.tenancyId, amount: 20000, method: 'M-Pesa', reference: 'E2ETEST01' } });
  check('admin records a payment', paid.status === 200, paid.text.slice(0, 160));
  await new Promise((r) => setTimeout(r, 2500));
  check('tenant channel got message_sent and data_updated', received.some((m) => m.event === 'message_sent') && received.some((m) => m.event === 'data_updated'),
    JSON.stringify(received.map((m) => m.event)));
  check('no message text in any broadcast', !JSON.stringify(received).includes('E2E reply'));
  await channel.unsubscribe();
  const payments = (await tenant.from('payments').select('*')).data ?? [];
  check('tenant sees the recorded payment', payments.length === 1 && payments[0].amount === 20000, JSON.stringify(payments));
  const msgs = (await tenant.from('messages').select('*')).data ?? [];
  check('tenant sees the reply', msgs.some((m) => m.body === 'E2E reply from the manager'));

  console.log('Admin endpoints guard their company');
  const tk = await http('/api/update-ticket', { method: 'POST', json: { ticketId: ticket.data?.id, status: 'in_progress', assignedTo: 'E2E Fundi' } });
  check('updates the ticket', tk.status === 200, tk.text.slice(0, 120));
  const tk404 = await http('/api/update-ticket', { method: 'POST', json: { ticketId: 'MT-NOPE', status: 'resolved' } });
  check('unknown ticket is 404, not success', tk404.status === 404, `status ${tk404.status}`);
  const typing404 = await http('/api/typing', { method: 'POST', json: { tenancyId: 'not-a-tenancy', isTyping: true } });
  check('typing for an unknown tenancy is 404', typing404.status === 404, `status ${typing404.status}`);
  const inj = await http('/api/reset-password', { method: 'POST', json: { phone: '0700000999,id.neq.x' } });
  check('reset rejects anything that is not a phone number', inj.status === 400, `status ${inj.status}`);
  const other = await http('/api/reset-password', { method: 'POST', json: { phone: '0711111111' } });
  check("reset refuses a number that isn't this company's tenant", other.status === 404, `status ${other.status}`);
  const reset = await http('/api/reset-password', { method: 'POST', json: { phone: PHONE } });
  check('reset issues a new one-time password', reset.status === 200 && reset.data?.password, reset.text.slice(0, 120));
  const again = newTenantClient();
  await again.auth.signInWithPassword({ email: EMAIL, password: reset.data?.password });
  const status3 = await again.rpc('account_status');
  check('after reset the tenant must change password again', status3.data?.mustChangePassword === true, JSON.stringify(status3.data));
  const hidden2 = await again.from('tenancies').select('id');
  check('and sees nothing until they do', hidden2.data?.length === 0);

  const rates = await http('/api/update-rates', { method: 'POST', json: { propertyId: 'kilimani-heights', waterRate: 160, garbageFee: 300 } });
  const { data: propAfter } = await svc.from('properties').select('rate_history').eq('id', 'kilimani-heights').single();
  const next = new Date(Date.now() + 3 * 3600e3); next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + 1);
  check('new rates go into history from next month', rates.status === 200 &&
    propAfter.rate_history.some((r) => r.from === next.toISOString().slice(0, 7) && r.waterRate === 160 && r.garbageFee === 300),
    JSON.stringify(propAfter.rate_history));

  const mo = await http('/api/move-out', { method: 'POST', json: { tenancyId: created.tenancyId, moveOutDate: '2026-10-31', note: 'E2E' } });
  check('moves the tenant out', mo.status === 200, mo.text.slice(0, 120));
  const mo404 = await http('/api/move-out', { method: 'POST', json: { tenancyId: 'not-a-tenancy', moveOutDate: '2026-10-31' } });
  check('unknown tenancy move-out is 404', mo404.status === 404, `status ${mo404.status}`);

  const tenantsPage = await http('/tenants');
  check('admin tenants page shows the test tenant', tenantsPage.text.includes('E2E Test Tenant'));
} catch (err) {
  failures.push(`crashed: ${err?.message ?? err}`);
  console.error(err);
} finally {
  console.log('Cleanup');
  const t = created.tenancyId;
  if (t) {
    for (const table of ['messages', 'repair_tickets', 'payments']) {
      const r = await svc.from(table).delete().eq('tenancy_id', t);
      if (r.error) console.log('  !', table, r.error.message);
    }
    await svc.from('audit_log').delete().eq('target', t);
    const r = await svc.from('tenancies').delete().eq('id', t);
    if (r.error) console.log('  ! tenancies', r.error.message);
  }
  if (created.unitId) await svc.from('meter_readings').delete().eq('unit_id', created.unitId).eq('month', '2026-10');
  const { data: leftover } = await svc.from('tenants').select('id,auth_user_id').eq('phone', PHONE);
  for (const row of leftover ?? []) {
    await svc.from('audit_log').delete().eq('target', row.id);
    await svc.from('tenants').delete().eq('id', row.id);
    if (row.auth_user_id) created.authUserId ??= row.auth_user_id;
  }
  const { data: users } = await svc.auth.admin.listUsers({ perPage: 1000 });
  for (const u of users.users.filter((u) => u.email === EMAIL)) await svc.auth.admin.deleteUser(u.id);
  await svc.from('companies').update({ sequences: companyBefore.sequences }).eq('id', 'harborridge');
  await svc.from('properties').update(propBefore).eq('id', 'kilimani-heights');
  const { count } = await svc.from('tenants').select('id', { count: 'exact', head: true }).eq('phone', PHONE);
  console.log(`  removed test data (tenants left with test phone: ${count})`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
