// Portfolio totals a landlord shares with SCCE, the credit engine lenders read.
//
// Only company-level totals leave Makazi: no tenant names, phone numbers or
// individual payments. Every figure comes from the billing engine, so SCCE
// sees the same collections and arrears as the admin's own pages.

import {
  arrearsSlices,
  buildLedger,
  collectedFor,
  daysBetween,
  daysInMonth,
  expectedFor,
  monthOf,
  monthsBetween,
  type Company,
  type Month,
  type Payment,
  type Seed,
} from '../billing';
import { seedAsAt } from '../as-at';

/** Bumped whenever a field is added, removed or changes meaning. */
export const FEATURES_SCHEMA_VERSION = 1;

/** Owner's choice in Settings; stored in company.settings.scce. */
export interface ScceSharing {
  enabled: boolean;
  /** When sharing was last turned on (ISO). */
  enabledAt: string | null;
  /** Email of the owner who turned it on. */
  enabledBy: string | null;
  disabledAt: string | null;
}

export function scceSharingOf(company: Pick<Company, 'settings'>): ScceSharing {
  const raw = (company.settings as { scce?: Partial<ScceSharing> }).scce;
  return {
    enabled: raw?.enabled === true,
    enabledAt: raw?.enabledAt ?? null,
    enabledBy: raw?.enabledBy ?? null,
    disabledAt: raw?.disabledAt ?? null,
  };
}

/** One closed month of a landlord's portfolio. Money in whole KES. */
export interface PortfolioMonth {
  month: Month;
  properties: number;
  /** Units on Makazi today; units have no created date, so past months use today's count. */
  units: number;
  /** Units with a tenant on the month's last day. */
  occupiedUnits: number;
  /** Unit-days with a tenant in the month, and unit-days available. */
  occupiedUnitDays: number;
  unitDays: number;
  activeTenancies: number;
  moveIns: number;
  moveOuts: number;
  /** Rent, water and garbage on this month's bills. Deposits are not income. */
  billedKes: number;
  rentBilledKes: number;
  /** Received in the month, less the part that paid a deposit. */
  collectedKes: number;
  /** The M-Pesa part of collectedKes. */
  mpesaCollectedKes: number;
  /** Owed on the month's last day, and the part more than 30 or 90 days past grace. */
  arrearsKes: number;
  arrearsOver30Kes: number;
  arrearsOver90Kes: number;
  tenanciesOver30: number;
  repairsOpened: number;
  repairsResolved: number;
  /** Median days from request to resolved, for repairs resolved this month. */
  repairDaysMedian: number | null;
  /** M-Pesa test-mode payments left out of every figure above. */
  testPaymentsExcluded: number;
}

const isTestPayment = (p: Payment) => (p as Payment & { simulated?: boolean }).simulated === true;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function monthEnd(month: Month): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

/** Days in [from, to] inclusive, or 0 when the range is empty. */
function inclusiveDays(from: string, to: string): number {
  return from > to ? 0 : daysBetween(from, to) + 1;
}

/** Assumes `seed` holds one company with test payments already removed. */
function monthOfPortfolio(seed: Seed, month: Month, testPaymentsExcluded: number): PortfolioMonth {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const atEnd = seedAsAt(seed, month);

  const active = atEnd.tenancies.filter((t) => t.moveOut === null);

  // A tenant occupies the unit from move-in up to the day before move-out.
  const daysByUnit = new Map<string, number>();
  for (const t of seed.tenancies) {
    const lastDay = t.moveOut ? new Date(Date.parse(`${t.moveOut}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : end;
    const days = inclusiveDays(t.moveIn > start ? t.moveIn : start, lastDay < end ? lastDay : end);
    if (days > 0) daysByUnit.set(t.unitId, (daysByUnit.get(t.unitId) ?? 0) + days);
  }
  const monthDays = daysInMonth(month);
  let occupiedUnitDays = 0;
  for (const days of daysByUnit.values()) occupiedUnitDays += Math.min(days, monthDays);

  let billedKes = 0;
  let rentBilledKes = 0;
  let collectedKes = 0;
  let mpesaCollectedKes = 0;
  let arrearsKes = 0;
  let arrearsOver30Kes = 0;
  let arrearsOver90Kes = 0;
  let tenanciesOver30 = 0;

  for (const tenancy of atEnd.tenancies) {
    const ledger = buildLedger(atEnd, tenancy);
    const bill = ledger.find((b) => b.month === month);
    if (bill) {
      const collected = collectedFor(bill);
      const mpesaPaid = bill.payments.filter((p) => p.method === 'M-Pesa').reduce((sum, p) => sum + p.amount, 0);
      billedKes += expectedFor(bill);
      rentBilledKes += bill.rent;
      collectedKes += collected;
      mpesaCollectedKes += bill.amountPaid > 0 ? Math.round((collected * mpesaPaid) / bill.amountPaid) : 0;
    }

    const slices = arrearsSlices(atEnd, tenancy, ledger);
    let over30 = 0;
    for (const s of slices) {
      arrearsKes += s.amount;
      if (s.daysOverdue > 30) over30 += s.amount;
      if (s.daysOverdue > 90) arrearsOver90Kes += s.amount;
    }
    arrearsOver30Kes += over30;
    if (over30 > 0) tenanciesOver30 += 1;
  }

  const resolved = seed.repairTickets.filter((t) => t.resolvedAt && monthOf(t.resolvedAt.slice(0, 10)) === month);

  return {
    month,
    properties: seed.properties.length,
    units: seed.units.length,
    occupiedUnits: new Set(active.map((t) => t.unitId)).size,
    occupiedUnitDays,
    unitDays: seed.units.length * monthDays,
    activeTenancies: active.length,
    moveIns: seed.tenancies.filter((t) => monthOf(t.moveIn) === month).length,
    moveOuts: seed.tenancies.filter((t) => t.moveOut && monthOf(t.moveOut) === month).length,
    billedKes,
    rentBilledKes,
    collectedKes,
    mpesaCollectedKes,
    arrearsKes,
    arrearsOver30Kes,
    arrearsOver90Kes,
    tenanciesOver30,
    repairsOpened: seed.repairTickets.filter((t) => monthOf(t.createdAt.slice(0, 10)) === month).length,
    repairsResolved: resolved.length,
    repairDaysMedian: median(resolved.map((t) => daysBetween(t.createdAt.slice(0, 10), t.resolvedAt!.slice(0, 10)))),
    testPaymentsExcluded,
  };
}

/**
 * Closed months `from`..`to` for one company. Months before the company's
 * first month on Makazi are skipped: there is nothing on record for them.
 */
export function portfolioMonths(seed: Seed, companyId: string, from: Month, to: Month): PortfolioMonth[] {
  const company = seed.companies.find((c) => c.id === companyId);
  if (!company) throw new Error(`No company ${companyId} in seed`);
  const realPayments = seed.payments.filter((p) => !isTestPayment(p));
  const real: Seed = { ...seed, payments: realPayments };
  const start = company.settings.ledgerStartMonth > from ? company.settings.ledgerStartMonth : from;
  return monthsBetween(start, to).map((month) =>
    monthOfPortfolio(
      real,
      month,
      seed.payments.filter((p) => isTestPayment(p) && monthOf(p.date) === month).length,
    ),
  );
}
