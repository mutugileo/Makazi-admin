// Supabase data fetcher for PropAdmin — Phase 2.
//
// Fetches all tables required by the billing engine and assembles them into a
// Seed object that is structurally identical to shared/billing-seed.json.
// The billing engine (billing.ts) and all view-model derivations (portfolio.ts)
// are unchanged — they just receive live data instead of JSON.
//
// Table names match the SQL schema in supabase/schema.sql (snake_case).
// Column names are camelCase in TypeScript (mapped below).
//
// Row-Level Security: every query runs as the signed-in user so each company
// sees only its own rows automatically.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Seed, Company, Property, Unit, Tenant, Tenancy, Payment, StaffMember, RepairTicket, Message } from './billing';

// Helper: throw a descriptive error on Supabase query failures.
function assertOk<T>(data: T | null, error: { message: string } | null, label: string): T {
  if (error) throw new Error(`Supabase [${label}]: ${error.message}`);
  if (data === null) throw new Error(`Supabase [${label}]: returned null`);
  return data;
}

// ---------------------------------------------------------------------------
// Row types (what Supabase returns — snake_case column names)

interface CompanyRow {
  id: string; slug: string; name: string; kra_pin: string;
  mpesa_paybill: string; bank_name: string; bank_account: string;
  settings: Company['settings']; sequences: Company['sequences'];
  subscription: Company['subscription'];
}

interface PropertyRow {
  id: string; company_id: string; manager_id: string; name: string;
  type: Property['type']; address: string; account_prefix: string;
  water_rate: number; garbage_fee: number; rate_history: Property['rateHistory'];
}

interface UnitRow {
  id: string; property_id: string; label: string; bedrooms: number;
}

interface TenantRow {
  id: string; company_id: string; name: string; phone: string; email: string;
}

interface TenancyRow {
  id: string; tenant_id: string; unit_id: string; rent: number; deposit: number;
  move_in: string; move_out: string | null; lease_start: string; lease_end: string;
  opening_balance: number; opening_reading: number | null;
  renewal: Tenancy['renewal']; move_out_note: string | null;
  deposit_refund: Tenancy['depositRefund'];
}

interface PaymentRow {
  receipt_number: string; tenancy_id: string; amount: number;
  date: string; time: string; method: Payment['method']; reference: string;
  simulated?: boolean;
}

interface StaffRow {
  id: string; company_id: string; name: string; role: StaffMember['role'];
  phone: string | null; property_ids: string[];
}

interface MeterReadingRow {
  unit_id: string; month: string; value: number;
}

interface RepairTicketRow {
  id: string; company_id: string; tenancy_id: string; unit_id: string;
  category: RepairTicket['category']; priority: RepairTicket['priority'];
  status: RepairTicket['status']; title: string; description: string;
  has_photo: boolean; created_at: string; resolved_at: string | null;
  assigned_to: string | null; resolution_note: string | null;
  // Added by 20261008090000_repair_visit_details; absent before it's applied.
  assigned_phone?: string | null; visit_at?: string | null;
}

interface MessageRow {
  id: string; company_id: string; tenancy_id: string;
  sender: Message['sender']; staff_id: string | null; body: string;
  sent_at: string; read_by_staff_at: string | null;
}

// ---------------------------------------------------------------------------
// Row → domain type mappers

/** A Postgres timestamptz as Nairobi time ('YYYY-MM-DDTHH:MM:SS+03:00', like
 * the seed): the pages slice the date and clock time straight out of it. */
export function nairobiIso(timestamptz: string): string {
  const local = new Date(new Date(timestamptz).getTime() + 3 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, 19)}+03:00`;
}

const mapCompany = (r: CompanyRow): Company => ({
  id: r.id, slug: r.slug, name: r.name, kraPin: r.kra_pin,
  mpesaPaybill: r.mpesa_paybill, bankName: r.bank_name, bankAccount: r.bank_account,
  settings: r.settings, sequences: r.sequences, subscription: r.subscription,
});

const mapProperty = (r: PropertyRow, propertyImages?: Record<string, string>): Property => ({
  id: r.id, companyId: r.company_id, managerId: r.manager_id, name: r.name,
  type: r.type, address: r.address, accountPrefix: r.account_prefix,
  waterRate: r.water_rate, garbageFee: r.garbage_fee, rateHistory: r.rate_history ?? [],
  imageUrl: propertyImages?.[r.id] ?? null,
});

const mapUnit = (r: UnitRow): Unit => ({
  id: r.id, propertyId: r.property_id, label: r.label, bedrooms: r.bedrooms,
});

const mapTenant = (r: TenantRow): Tenant => ({
  id: r.id, companyId: r.company_id, name: r.name, phone: r.phone, email: r.email,
});

const mapTenancy = (r: TenancyRow): Tenancy => ({
  id: r.id, tenantId: r.tenant_id, unitId: r.unit_id,
  rent: r.rent, deposit: r.deposit,
  moveIn: r.move_in, moveOut: r.move_out, leaseStart: r.lease_start, leaseEnd: r.lease_end,
  openingBalance: r.opening_balance, openingReading: r.opening_reading,
  renewal: r.renewal, moveOutNote: r.move_out_note, depositRefund: r.deposit_refund,
});

const mapPayment = (r: PaymentRow): Payment => ({
  receiptNumber: r.receipt_number, tenancyId: r.tenancy_id, amount: r.amount,
  date: r.date, time: r.time.slice(0, 5), method: r.method, reference: r.reference,
  simulated: r.simulated === true,
});

const mapStaff = (r: StaffRow): StaffMember => ({
  id: r.id, companyId: r.company_id, name: r.name, role: r.role,
  phone: r.phone, propertyIds: r.property_ids ?? [],
});

const mapTicket = (r: RepairTicketRow): RepairTicket => ({
  id: r.id, companyId: r.company_id, tenancyId: r.tenancy_id, unitId: r.unit_id,
  category: r.category, priority: r.priority, status: r.status,
  title: r.title, description: r.description, hasPhoto: r.has_photo,
  createdAt: nairobiIso(r.created_at), resolvedAt: r.resolved_at ? nairobiIso(r.resolved_at) : null,
  assignedTo: r.assigned_to, resolutionNote: r.resolution_note,
  assignedPhone: r.assigned_phone ?? null, visitAt: r.visit_at ? nairobiIso(r.visit_at) : null,
});

const mapMessage = (r: MessageRow): Message => ({
  id: r.id, companyId: r.company_id, tenancyId: r.tenancy_id,
  sender: r.sender, staffId: r.staff_id, body: r.body,
  sentAt: nairobiIso(r.sent_at), readByStaffAt: r.read_by_staff_at,
});

// ---------------------------------------------------------------------------
// Main fetcher — runs all queries concurrently for speed.

/**
 * Fetches the entire data set for one company from Supabase and returns a
 * Seed that is structurally identical to shared/billing-seed.json.
 *
 * RLS on the server enforces the company scope; we still filter by companyId
 * in JS to be defensive and to satisfy the billing engine's scopeSeed contract.
 *
 * asOf defaults to today in Nairobi time (UTC+3). This is the only difference
 * from the seed, where asOf is a fixed demo date.
 */
const PAGE_SIZE = 1000;

/**
 * Every row of a table for one company. The Data API returns at most 1,000
 * rows per request and says nothing when it stops, which would quietly drop
 * payments or meter readings once a company has enough units. So: page by a
 * stable order until the database's own count is reached, and fail rather
 * than build balances from a partial list.
 */
async function allRows(
  supabase: SupabaseClient,
  table: string,
  companyColumn: string,
  companyId: string,
  orderBy: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ data: any[] | null; error: { message: string } | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = [];
  let total: number | null = null;
  // Advance by the rows actually received: a server cap below PAGE_SIZE
  // must not skip any.
  for (let from = 0; total === null || rows.length < total; from = rows.length) {
    let query = supabase
      .from(table)
      .select('*', from === 0 ? { count: 'exact' } : undefined)
      .eq(companyColumn, companyId);
    for (const column of orderBy) query = query.order(column, { ascending: true });
    const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    if (from === 0) total = count ?? 0;
    rows.push(...(data ?? []));
    if (!data?.length) break;
  }
  if (rows.length !== total) {
    return { data: null, error: { message: `read ${rows.length} of ${total} rows; try again` } };
  }
  return { data: rows, error: null };
}

export async function fetchSeedFromSupabase(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Seed> {
  const asOf = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // today, Nairobi

  const [
    companiesRes,
    propertiesRes,
    unitsRes,
    tenantsRes,
    tenanciesRes,
    paymentsRes,
    staffRes,
    meterReadingsRes,
    ticketsRes,
    messagesRes,
  ] = await Promise.all([
    allRows(supabase, 'companies', 'id', companyId, ['id']),
    allRows(supabase, 'properties', 'company_id', companyId, ['id']),
    allRows(supabase, 'units', 'company_id', companyId, ['id']),
    allRows(supabase, 'tenants', 'company_id', companyId, ['id']),
    allRows(supabase, 'tenancies', 'company_id', companyId, ['id']),
    allRows(supabase, 'payments', 'company_id', companyId, ['receipt_number']),
    allRows(supabase, 'staff', 'company_id', companyId, ['id']),
    allRows(supabase, 'meter_readings', 'company_id', companyId, ['unit_id', 'month']),
    allRows(supabase, 'repair_tickets', 'company_id', companyId, ['id']),
    allRows(supabase, 'messages', 'company_id', companyId, ['id']),
  ]);

  const companies = assertOk(companiesRes.data, companiesRes.error, 'companies').map(mapCompany);
  const propertyImages = (companiesRes.data?.[0]?.settings?.propertyImages ?? {}) as Record<string, string>;
  const properties = assertOk(propertiesRes.data, propertiesRes.error, 'properties').map((p) => mapProperty(p, propertyImages));
  const units = assertOk(unitsRes.data, unitsRes.error, 'units').map(mapUnit);
  const tenants = assertOk(tenantsRes.data, tenantsRes.error, 'tenants').map(mapTenant);
  const tenancies = assertOk(tenanciesRes.data, tenanciesRes.error, 'tenancies').map(mapTenancy);
  const payments = assertOk(paymentsRes.data, paymentsRes.error, 'payments').map(mapPayment);
  const staff = assertOk(staffRes.data, staffRes.error, 'staff').map(mapStaff);
  const repairTickets = assertOk(ticketsRes.data, ticketsRes.error, 'repair_tickets').map(mapTicket);
  const messages = assertOk(messagesRes.data, messagesRes.error, 'messages').map(mapMessage);

  // meter_readings: flatten rows → nested Record<unitId, Record<month, value>>
  const rawReadings = assertOk(meterReadingsRes.data, meterReadingsRes.error, 'meter_readings') as MeterReadingRow[];
  const meterReadings: Record<string, Record<string, number>> = {};
  for (const r of rawReadings) {
    if (!meterReadings[r.unit_id]) meterReadings[r.unit_id] = {};
    meterReadings[r.unit_id][r.month] = r.value;
  }

  return { asOf, companies, properties, units, tenants, tenancies, meterReadings, payments, staff, repairTickets, messages };
}
