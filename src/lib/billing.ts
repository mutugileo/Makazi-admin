// Billing engine for Makazi. Pure functions over the seed facts in
// shared/billing-seed.json. The Flutter app mirrors this file in
// lib/core/billing/billing_engine.dart; shared/billing-expected.json is the
// parity fixture both engines are tested against. Rules: shared/README.md.

export type Month = string; // 'YYYY-MM'
export type IsoDate = string; // 'YYYY-MM-DD'

export type PropertyType = 'apartments' | 'houses';
export type PaymentMethod = 'M-Pesa' | 'Bank';
export type BillKind = 'move-in' | 'monthly' | 'final';
export type BillStatus = 'Paid' | 'Partial' | 'Unpaid' | 'Credit';
export type BillLineKind =
  | 'rent'
  | 'water'
  | 'garbage'
  | 'deposit'
  | 'deposit_applied'
  | 'deposit_refund';

/** Billing rules a landlord chooses for themselves. */
export interface CompanySettings {
  /** First month on Makazi; earlier balances come in as openingBalance. */
  ledgerStartMonth: Month;
  dueDay: number;
  /** Last day of the grace period; a bill is overdue only after this day. */
  graceDay: number;
  /** Deposit by number of bedrooms, e.g. { "1": 25000, "2": 30000 }. */
  depositSchedule: Record<string, number>;
  /** Months a former tenant's records are kept after move-out. */
  recordRetentionMonths: number;
}

/** Last numbers issued; each company has its own series. */
export interface CompanySequences {
  receipt: number;
  repairTicket: number;
}

export type PlanId = 'starter' | 'growth' | 'pro';
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended';

/** Makazi subscription. Stored and shown; not enforced or billed yet. */
export interface Subscription {
  plan: PlanId;
  status: SubscriptionStatus;
  unitLimit: number;
  staffLimit: number;
  trialEndsAt: IsoDate | null;
}

/** A landlord on the Makazi platform. Every record belongs to one. */
export interface Company {
  id: string;
  /** Short name for URLs, e.g. harborridge.makazi.co.ke later. */
  slug: string;
  name: string;
  kraPin: string;
  mpesaPaybill: string;
  bankName: string;
  bankAccount: string;
  settings: CompanySettings;
  sequences: CompanySequences;
  subscription: Subscription;
}

/** Rates in force from a month onwards. */
export interface PropertyRates {
  from: Month;
  waterRate: number;
  garbageFee: number;
}

export interface Property {
  id: string;
  companyId: string;
  /** Staff member who manages this property and answers its tenants. */
  managerId: string;
  name: string;
  type: PropertyType;
  address: string;
  accountPrefix: string;
  /** Current rates (the latest entry in rateHistory). */
  waterRate: number;
  garbageFee: number;
  /** Every rate change, oldest first. Bills use the rates in force for their month. */
  rateHistory: PropertyRates[];
  imageUrl?: string | null;
}

/** Rates in force for a bill month; before the first change, the earliest rates. */
export function ratesFor(property: Property, month: Month): { waterRate: number; garbageFee: number } {
  let rates = property.rateHistory[0] ?? { waterRate: property.waterRate, garbageFee: property.garbageFee };
  for (const r of property.rateHistory) if (r.from <= month) rates = r;
  return { waterRate: rates.waterRate, garbageFee: rates.garbageFee };
}

export interface Unit {
  id: string;
  propertyId: string;
  label: string;
  bedrooms: number;
}

export interface Tenant {
  id: string;
  companyId: string;
  name: string;
  phone: string;
  email: string;
}

export interface TenancyRenewal {
  leaseId: string;
  rent: number;
  start: IsoDate;
  end: IsoDate;
  status: 'Awaiting signature';
}

export interface DepositRefund {
  date: IsoDate;
  method: PaymentMethod;
  reference: string;
}

export interface Tenancy {
  id: string;
  tenantId: string;
  unitId: string;
  rent: number;
  deposit: number;
  moveIn: IsoDate;
  moveOut: IsoDate | null;
  leaseStart: IsoDate;
  leaseEnd: IsoDate;
  /** Balance carried in from the owner's spreadsheet at the company's ledgerStartMonth. */
  openingBalance: number;
  /** Water meter at move-in. Null for tenancies older than the ledger. */
  openingReading: number | null;
  renewal: TenancyRenewal | null;
  /** Free-text note recorded at move-out (internal, not a reference). */
  moveOutNote: string | null;
  depositRefund: DepositRefund | null;
}

export interface Payment {
  receiptNumber: string;
  tenancyId: string;
  amount: number;
  date: IsoDate;
  time: string;
  method: PaymentMethod;
  reference: string;
}

export type StaffRole = 'owner' | 'manager' | 'caretaker';

export interface StaffMember {
  id: string;
  companyId: string;
  name: string;
  role: StaffRole;
  phone: string | null;
  /** Properties this person works on; empty means all of the company's. */
  propertyIds: string[];
}

/** One list for the app's request form and the admin's board. */
export const REPAIR_CATEGORIES = ['plumbing', 'electrical', 'carpentry', 'appliance', 'security'] as const;
export type RepairCategory = (typeof REPAIR_CATEGORIES)[number];
export type RepairPriority = 'low' | 'medium' | 'high';
export type RepairStatus = 'open' | 'in_progress' | 'resolved';

export const REPAIR_CATEGORY_LABELS: Record<RepairCategory, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  carpentry: 'Carpentry',
  appliance: 'Appliance',
  security: 'Security & access',
};
export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};
export const REPAIR_PRIORITY_LABELS: Record<RepairPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };

export interface RepairTicket {
  /** Display code, e.g. 'MT-1047'. */
  id: string;
  companyId: string;
  tenancyId: string;
  unitId: string;
  category: RepairCategory;
  /** Set by staff when triaging; new requests start at 'medium'. */
  priority: RepairPriority;
  status: RepairStatus;
  title: string;
  description: string;
  hasPhoto: boolean;
  /** ISO date-time, Nairobi time. */
  createdAt: string;
  resolvedAt: string | null;
  /** Fundi or company doing the work. */
  assignedTo: string | null;
  resolutionNote: string | null;
}

export interface Message {
  id: string;
  companyId: string;
  tenancyId: string;
  sender: 'tenant' | 'staff';
  staffId: string | null;
  body: string;
  /** ISO date-time, Nairobi time. */
  sentAt: string;
  /** When staff read a tenant's message; null = unread. */
  readByStaffAt: string | null;
}

export interface Seed {
  /** The demo's "today". */
  asOf: IsoDate;
  companies: Company[];
  properties: Property[];
  units: Unit[];
  tenants: Tenant[];
  tenancies: Tenancy[];
  /** unitId -> month -> reading taken on the 1st of that month. */
  meterReadings: Record<string, Record<Month, number>>;
  payments: Payment[];
  staff: StaffMember[];
  repairTickets: RepairTicket[];
  messages: Message[];
}

export interface BillLine {
  kind: BillLineKind;
  amount: number;
}

export interface WaterUsage {
  previousReading: number;
  currentReading: number;
  units: number;
  rate: number;
  amount: number;
}

export interface ProratedDays {
  days: number;
  of: number;
}

export interface MonthlyBill {
  tenancyId: string;
  month: Month;
  kind: BillKind;
  dueDate: IsoDate;
  /** Last day of the grace period. */
  graceDate: IsoDate;
  /** Set when rent covers only part of the month (mid-month move-in). */
  rentDays: ProratedDays | null;
  lines: BillLine[];
  water: WaterUsage | null;
  rent: number;
  garbage: number;
  deposit: number;
  depositApplied: number;
  depositRefund: number;
  balanceBf: number;
  newCharges: number;
  totalDue: number;
  amountPaid: number;
  outstanding: number;
  status: BillStatus;
  datePaid: IsoDate | null;
  payments: Payment[];
}

// ---------------------------------------------------------------------------
// Date helpers (UTC, string based so TS and Dart agree exactly)

export function monthOf(date: IsoDate): Month {
  return date.slice(0, 7);
}

export function addMonths(month: Month, delta: number): Month {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const mon = (index % 12) + 1;
  return `${year}-${String(mon).padStart(2, '0')}`;
}

export function monthsBetween(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function dueDateOf(month: Month, dueDay: number): IsoDate {
  return `${month}-${String(dueDay).padStart(2, '0')}`;
}

export function daysInMonth(month: Month): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Same day n months later, clamped to the month's last day. */
export function addMonthsToDate(date: IsoDate, delta: number): IsoDate {
  const month = addMonths(monthOf(date), delta);
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}

/**
 * Rent for a mid-month move-in: the days left in the month, counting the
 * move-in day. Moving in on the 1st is a full month (null).
 */
export function proratedRent(rent: number, moveIn: IsoDate): { amount: number; days: ProratedDays | null } {
  const of = daysInMonth(monthOf(moveIn));
  const days = of - Number(moveIn.slice(8, 10)) + 1;
  if (days >= of) return { amount: rent, days: null };
  return { amount: Math.round((rent * days) / of), days: { days, of } };
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(month: Month): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function shortMonthLabel(month: Month): string {
  const [, m] = month.split('-').map(Number);
  return MONTH_NAMES[m - 1].slice(0, 3);
}

export function formatDate(date: IsoDate): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}

export function formatKes(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  return `${sign}KES ${Math.abs(amount).toLocaleString('en-KE')}`;
}

// ---------------------------------------------------------------------------
// Engine

export function statusFor(amountPaid: number, outstanding: number): BillStatus {
  if (outstanding < 0) return 'Credit';
  if (outstanding === 0) return 'Paid';
  return amountPaid > 0 ? 'Partial' : 'Unpaid';
}

export function companyOfProperty(seed: Seed, propertyId: string): Company {
  const property = seed.properties.find((p) => p.id === propertyId);
  const company = property && seed.companies.find((c) => c.id === property.companyId);
  if (!company) throw new Error(`No company for property ${propertyId}`);
  return company;
}

export function companyOfTenancy(seed: Seed, tenancy: Tenancy): Company {
  const unit = seed.units.find((u) => u.id === tenancy.unitId);
  if (!unit) throw new Error(`Unknown unit for ${tenancy.id}`);
  return companyOfProperty(seed, unit.propertyId);
}

function reading(seed: Seed, unitId: string, month: Month): number | null {
  const value = seed.meterReadings[unitId]?.[month];
  return value !== undefined ? value : null;
}

function waterFor(seed: Seed, unitId: string, month: Month, rate: number, opening: number | null): WaterUsage | null {
  const currentReading = reading(seed, unitId, month);
  if (currentReading === null) return null;
  const previousReading = opening ?? reading(seed, unitId, addMonths(month, -1));
  if (previousReading === null) return null;
  const units = Math.max(0, currentReading - previousReading);
  return { previousReading, currentReading, units, rate, amount: units * rate };
}

/** First and last month a tenancy is billed for within the seed window. */
export function billingWindow(seed: Seed, tenancy: Tenancy): [Month, Month] | null {
  const asOfMonth = monthOf(seed.asOf);
  const start = companyOfTenancy(seed, tenancy).settings.ledgerStartMonth;
  const moveInMonth = monthOf(tenancy.moveIn);
  const first = moveInMonth > start ? moveInMonth : start;

  // Find any active future months (meter readings, payments, or the move-in itself)
  const unitReadings = Object.keys(seed.meterReadings[tenancy.unitId] ?? {});
  const tenancyPayments = seed.payments.filter((p) => p.tenancyId === tenancy.id).map((p) => monthOf(p.date));
  const candidateMonths = [asOfMonth, ...unitReadings, ...tenancyPayments];
  const maxActive = candidateMonths.sort().pop()!;

  const finalMonth = tenancy.moveOut ? addMonths(monthOf(tenancy.moveOut), 1) : maxActive;
  const last = finalMonth < maxActive ? finalMonth : maxActive;
  return first <= last ? [first, last] : null;
}

export function buildLedger(seed: Seed, tenancy: Tenancy): MonthlyBill[] {
  const window = billingWindow(seed, tenancy);
  if (!window) return [];

  const unit = seed.units.find((u) => u.id === tenancy.unitId);
  const property = unit && seed.properties.find((p) => p.id === unit.propertyId);
  if (!unit || !property) throw new Error(`Unknown unit for ${tenancy.id}`);
  const { settings } = companyOfTenancy(seed, tenancy);

  const moveInMonth = monthOf(tenancy.moveIn);
  const finalMonth = tenancy.moveOut ? addMonths(monthOf(tenancy.moveOut), 1) : null;
  const payments = seed.payments
    .filter((p) => p.tenancyId === tenancy.id)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  const bills: MonthlyBill[] = [];
  let balanceBf = tenancy.openingBalance;

  for (const month of monthsBetween(window[0], window[1])) {
    const kind: BillKind =
      month === finalMonth
        ? 'final'
        : month === moveInMonth && moveInMonth >= settings.ledgerStartMonth
          ? 'move-in'
          : 'monthly';

    const lines: BillLine[] = [];
    let water: WaterUsage | null = null;
    let rentDays: ProratedDays | null = null;
    const { waterRate, garbageFee } = ratesFor(property, month);
    // The first water bill after a move-in starts from the move-in reading.
    const opening =
      tenancy.openingReading !== null && addMonths(moveInMonth, 1) === month ? tenancy.openingReading : null;

    if (kind === 'move-in') {
      const rent = proratedRent(tenancy.rent, tenancy.moveIn);
      rentDays = rent.days;
      lines.push({ kind: 'deposit', amount: tenancy.deposit });
      lines.push({ kind: 'rent', amount: rent.amount });
      lines.push({ kind: 'garbage', amount: garbageFee });

      // If reading was recorded for the move-in month, include water consumption
      const currentReading = reading(seed, unit.id, month);
      if (currentReading !== null && tenancy.openingReading !== null && currentReading > tenancy.openingReading) {
        const units = currentReading - tenancy.openingReading;
        water = {
          previousReading: tenancy.openingReading,
          currentReading,
          units,
          rate: waterRate,
          amount: units * waterRate,
        };
        lines.push({ kind: 'water', amount: water.amount });
      }
    } else if (kind === 'monthly') {
      water = waterFor(seed, unit.id, month, waterRate, opening);
      lines.push({ kind: 'rent', amount: tenancy.rent });
      if (water && water.units > 0) {
        lines.push({ kind: 'water', amount: water.amount });
      }
      lines.push({ kind: 'garbage', amount: garbageFee });
    } else {
      water = waterFor(seed, unit.id, month, waterRate, opening);
      if (water && water.units > 0) {
        lines.push({ kind: 'water', amount: water.amount });
      }
      lines.push({ kind: 'deposit_applied', amount: -tenancy.deposit });
      const afterDeposit = balanceBf + (water?.amount ?? 0) - tenancy.deposit;
      if (afterDeposit < 0) {
        lines.push({ kind: 'deposit_refund', amount: -afterDeposit });
      }
    }

    const sumOf = (k: BillLineKind) =>
      lines.filter((l) => l.kind === k).reduce((acc, l) => acc + l.amount, 0);
    const monthPayments = payments.filter((p) => monthOf(p.date) === month);
    const amountPaid = monthPayments.reduce((acc, p) => acc + p.amount, 0);
    const newCharges = lines.reduce((acc, l) => acc + l.amount, 0);
    const totalDue = balanceBf + newCharges;
    const outstanding = totalDue - amountPaid;

    bills.push({
      tenancyId: tenancy.id,
      month,
      kind,
      dueDate: dueDateOf(month, settings.dueDay),
      graceDate: dueDateOf(month, settings.graceDay),
      rentDays,
      lines,
      water,
      rent: sumOf('rent'),
      garbage: sumOf('garbage'),
      deposit: sumOf('deposit'),
      depositApplied: sumOf('deposit_applied'),
      depositRefund: sumOf('deposit_refund'),
      balanceBf,
      newCharges,
      totalDue,
      amountPaid,
      outstanding,
      status: statusFor(amountPaid, outstanding),
      datePaid: monthPayments.length ? monthPayments[monthPayments.length - 1].date : null,
      payments: monthPayments,
    });

    balanceBf = outstanding;
  }

  return bills;
}

/** Money billed for the month that counts towards collections (no deposits). */
export function expectedFor(bill: MonthlyBill): number {
  return bill.rent + (bill.water?.amount ?? 0) + bill.garbage;
}

/** Payments received in the month, excluding the part that paid a deposit. */
export function collectedFor(bill: MonthlyBill): number {
  const depositPortion = Math.min(bill.deposit, bill.amountPaid);
  return bill.amountPaid - depositPortion;
}

export type ArrearsStage = 'upcoming' | 'grace' | 'overdue';

export interface ArrearsSlice {
  month: Month;
  dueDate: IsoDate;
  graceDate: IsoDate;
  amount: number;
  stage: ArrearsStage;
  /** Days past the end of the grace period (0 unless overdue). */
  daysOverdue: number;
}

function slice(seed: Seed, settings: CompanySettings, month: Month, amount: number): ArrearsSlice {
  const dueDate = dueDateOf(month, settings.dueDay);
  const graceDate = dueDateOf(month, settings.graceDay);
  const stage: ArrearsStage = seed.asOf <= dueDate ? 'upcoming' : seed.asOf <= graceDate ? 'grace' : 'overdue';
  return { month, dueDate, graceDate, amount, stage, daysOverdue: Math.max(0, daysBetween(graceDate, seed.asOf)) };
}

/**
 * Splits a tenancy's current balance into the months it came from. Payments
 * clear the oldest charges first, so whatever is still owed belongs to the
 * newest charges; walk backwards until the balance is used up.
 */
export function arrearsSlices(seed: Seed, tenancy: Tenancy, bills: MonthlyBill[]): ArrearsSlice[] {
  const { settings } = companyOfTenancy(seed, tenancy);
  const last = bills[bills.length - 1];
  let remaining = last ? last.outstanding : 0;
  const slices: ArrearsSlice[] = [];
  for (let i = bills.length - 1; i >= 0 && remaining > 0; i--) {
    const charge = Math.max(bills[i].newCharges, 0);
    const amount = Math.min(charge, remaining);
    if (amount > 0) slices.push(slice(seed, settings, bills[i].month, amount));
    remaining -= amount;
  }
  if (remaining > 0) {
    // Whatever is left was carried in from the spreadsheet before startMonth.
    slices.push(slice(seed, settings, addMonths(settings.ledgerStartMonth, -1), remaining));
  }
  return slices.reverse();
}

export function receiptDescription(bill: MonthlyBill, payment: Payment): string {
  const label = monthLabel(bill.month);
  const base =
    bill.kind === 'move-in'
      ? `Move-in bill, ${label}`
      : bill.kind === 'final'
        ? `Final bill, ${label}`
        : `Bill, ${label}`;
  let paidSoFar = 0;
  for (const p of bill.payments) {
    paidSoFar += p.amount;
    if (p.receiptNumber === payment.receiptNumber) break;
  }
  return bill.totalDue - paidSoFar > 0 ? `${base} (part)` : base;
}
