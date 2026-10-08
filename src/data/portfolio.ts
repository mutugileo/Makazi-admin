// Admin view models — Phase 1: derived from shared/billing-seed.json.
// Phase 2: fetched from Supabase when SUPABASE_URL + SUPABASE_ANON_KEY are
// set in .env.  Every money figure on every admin page comes through here so
// the admin and the tenant app always agree.

import seedJson from '../../shared/billing-seed.json';
import { supabaseConfigured, makeSupabaseClient } from '../lib/supabase';
import { fetchSeedFromSupabase } from '../lib/supabase-data';
import type { AstroCookies } from 'astro';
import {
  addMonths,
  type Company,
  addMonthsToDate,
  arrearsSlices,
  buildLedger,
  collectedFor,
  daysBetween,
  expectedFor,
  formatDate,
  monthLabel,
  monthOf,
  monthsBetween,
  receiptDescription,
  shortMonthLabel,
  type ArrearsSlice,
  type ArrearsStage,
  type BillStatus,
  type Month,
  type MonthlyBill,
  type Payment,
  type Property,
  type Seed,
  type Tenancy,
  type Tenant,
  type Unit,
  type Message,
  type RepairTicket,
  REPAIR_CATEGORY_LABELS,
  REPAIR_PRIORITY_LABELS,
  REPAIR_STATUS_LABELS,
} from '../lib/billing';

const platformSeed = seedJson as Seed;

// Platform-wide: the demo clock. Everything else is per company.
// "Today" is per request: the demo date in seed mode, the real date in
// Nairobi with Supabase. Pages read asOf / currentMonth / currentPeriod from
// getPortfolio(), never from a module constant.
export const companies: Company[] = platformSeed.companies;

export { formatDate, formatKes, monthLabel } from '../lib/billing';

export function bedLabel(bedrooms: number): string {
  return `${bedrooms} bed`;
}
/** '2026-10' + 1 -> 'November 2026' */
export function addMonthsLabel(month: Month, delta: number): string {
  return monthLabel(addMonths(month, delta));
}
/** 'Today, 07:40' · 'Yesterday' · '5 Oct' relative to the seed's today (same as the app's chatTimestamp). */
export function whenLabelAt(iso: string, asOf: string): string {
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  const days = daysBetween(date, asOf);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return 'Yesterday';
  // '5 Oct', the same as the tenant app.
  return formatDate(date).slice(0, 6).replace(/^0/, '');
}

export interface UnitView {
  unit: Unit;
  occupant: TenancyView | null;
  lastTenancy: TenancyView | null;
}

/** A run of months billed at the same rates. */
export interface RatePeriod {
  fromMonth: Month;
  toMonth: Month;
  waterRate: number;
  garbageFee: number;
}

export interface PropertyView {
  property: Property;
  /** Rates in force over time, oldest first (the last is current). */
  rateHistory: RatePeriod[];
  typeLabel: string;
  units: UnitView[];
  occupied: number;
  vacant: number;
  occupancyRate: number;
  expected: number;
  collected: number;
  collectionRate: number;
}

export interface PaymentView {
  payment: Payment;
  view: TenancyView;
  forDescription: string;
  dateLabel: string;
}

export type LeaseStatus = 'Active' | 'Expiring' | 'Awaiting signature' | 'Ended';

export interface LeaseView {
  leaseId: string;
  view: TenancyView;
  term: string;
  rent: number;
  status: LeaseStatus;
  action: 'Renew' | 'Countersign' | null;
  note: string;
}

export interface BillRow {
  month: Month;
  view: TenancyView;
  bill: MonthlyBill;
}

export interface TicketView {
  ticket: RepairTicket;
  view: TenancyView;
  categoryLabel: string;
  priorityLabel: string;
  statusLabel: string;
  reporter: string;
  when: string;
}

export interface ThreadView {
  view: TenancyView;
  messages: Message[];
  last: Message;
  unread: number;
}


/**
 * One company's slice of the platform data: what row-level security will
 * return for that company's staff in Phase 2. Nothing from another company
 * can appear in it.
 */
export function scopeSeed(all: Seed, companyId: string): Seed {
  const companies = all.companies.filter((c) => c.id === companyId);
  if (companies.length !== 1) throw new Error(`Unknown company ${companyId}`);
  const properties = all.properties.filter((p) => p.companyId === companyId);
  const propertyIds = new Set(properties.map((p) => p.id));
  const units = all.units.filter((u) => propertyIds.has(u.propertyId));
  const unitIds = new Set(units.map((u) => u.id));
  const tenancies = all.tenancies.filter((t) => unitIds.has(t.unitId));
  const tenancyIds = new Set(tenancies.map((t) => t.id));
  return {
    asOf: all.asOf,
    companies,
    properties,
    units,
    tenants: all.tenants.filter((t) => t.companyId === companyId),
    tenancies,
    meterReadings: Object.fromEntries(Object.entries(all.meterReadings).filter(([unitId]) => unitIds.has(unitId))),
    payments: all.payments.filter((p) => tenancyIds.has(p.tenancyId)),
    staff: all.staff.filter((s) => s.companyId === companyId),
    repairTickets: all.repairTickets.filter((t) => t.companyId === companyId && tenancyIds.has(t.tenancyId)),
    messages: all.messages.filter((m) => m.companyId === companyId && tenancyIds.has(m.tenancyId)),
  };
}

function buildPortfolio(companyId: string, seedOverride?: Seed) {
  const seed = seedOverride ? scopeSeed(seedOverride, companyId) : scopeSeed(platformSeed, companyId);
  const asOf = seed.asOf;
  const currentMonth: Month = monthOf(asOf);
  const currentPeriod = monthLabel(currentMonth);
  const whenLabel = (iso: string) => whenLabelAt(iso, asOf);
  const company = seed.companies[0];
  const { settings } = company;

  const propertyById = new Map(seed.properties.map((p) => [p.id, p]));
  const unitById = new Map(seed.units.map((u) => [u.id, u]));
  const tenantById = new Map(seed.tenants.map((t) => [t.id, t]));

  const tenancies: TenancyView[] = seed.tenancies.map((tenancy) => {
    const unit = unitById.get(tenancy.unitId)!;
    const property = propertyById.get(unit.propertyId)!;
    const tenant = tenantById.get(tenancy.tenantId)!;
    const bills = buildLedger(seed, tenancy);
    const last = bills[bills.length - 1] ?? null;
    const isActive = tenancy.moveOut === null;
    const balance = last ? last.outstanding : tenancy.openingBalance;
    const arrears = arrearsSlices(seed, tenancy, bills);
    const overdue = arrears.filter((a) => a.stage === 'overdue');
    const stage: ArrearsStage | null = overdue.length
      ? 'overdue'
      : arrears.some((a) => a.stage === 'grace')
        ? 'grace'
        : arrears.length
          ? 'upcoming'
          : null;
    return {
      tenancy,
      tenant,
      unit,
      property,
      bills,
      currentBill: isActive ? bills.find((b) => b.month === currentMonth) ?? null : null,
      balance,
      status: last ? last.status : 'Paid',
      isActive,
      accountNumber: `${property.accountPrefix}-${unit.label}`,
      unitLabel: `${unit.label} · ${property.name}`,
      arrears,
      overdueAmount: overdue.reduce((acc, a) => acc + a.amount, 0),
      daysOverdue: overdue.length ? overdue[0].daysOverdue : 0,
      stage: balance > 0 ? stage : null,
      recordsKeptUntil: tenancy.moveOut ? addMonthsToDate(tenancy.moveOut, settings.recordRetentionMonths) : null,
      depositHeld: isActive ? tenancy.deposit : 0,
    };
  });

  const activeTenancies = tenancies.filter((t) => t.isActive);
  const formerTenancies = tenancies.filter((t) => !t.isActive);

  // ---------------------------------------------------------------------------
  // Properties & units



  const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const billsIn = (views: TenancyView[], month: Month) =>
    views.flatMap((v) => v.bills.filter((b) => b.month === month));

  const propertyViews: PropertyView[] = seed.properties.map((property) => {
    const units = seed.units
      .filter((u) => u.propertyId === property.id)
      .map((unit) => {
        const history = tenancies.filter((t) => t.unit.id === unit.id);
        return {
          unit,
          occupant: history.find((t) => t.isActive) ?? null,
          lastTenancy:
            history
              .filter((t) => !t.isActive)
              .sort((a, b) => (b.tenancy.moveOut ?? '').localeCompare(a.tenancy.moveOut ?? ''))[0] ?? null,
        };
      });
    const occupied = units.filter((u) => u.occupant).length;

    // Rate history straight from the property's effective-dated rates; the
    // engine bills each month at the rates in force then.
    const rateHistory: RatePeriod[] = property.rateHistory.map((r, i, all) => ({
      fromMonth: r.from,
      toMonth: i < all.length - 1 ? addMonths(all[i + 1].from, -1) : currentMonth,
      waterRate: r.waterRate,
      garbageFee: r.garbageFee,
    }));

    const monthBills = billsIn(tenancies.filter((t) => t.property.id === property.id), currentMonth);
    const expected = monthBills.reduce((acc, b) => acc + expectedFor(b), 0);
    const collected = monthBills.reduce((acc, b) => acc + collectedFor(b), 0);

    return {
      property,
      rateHistory,
      typeLabel: property.type === 'houses' ? 'Houses' : 'Apartments',
      units,
      occupied,
      vacant: units.length - occupied,
      occupancyRate: percent(occupied, units.length),
      expected,
      collected,
      collectionRate: percent(collected, expected),
    };
  });

  const totalUnits = seed.units.length;
  const portfolioSummary = `${company.name.split(' ')[0].toUpperCase()} · ${seed.properties.length} PROPERTIES · ${totalUnits} UNITS`;

  // ---------------------------------------------------------------------------
  // Payments


  const payments: PaymentView[] = seed.payments
    .map((payment) => {
      const view = tenancies.find((t) => t.tenancy.id === payment.tenancyId)!;
      const bill = view.bills.find((b) => b.month === monthOf(payment.date))!;
      return { payment, view, forDescription: receiptDescription(bill, payment), dateLabel: formatDate(payment.date) };
    })
    .sort((a, b) =>
      `${b.payment.date}${b.payment.time}`.localeCompare(`${a.payment.date}${a.payment.time}`),
    );

  // ---------------------------------------------------------------------------
  // Overview metrics

  const currentBills = billsIn(tenancies, currentMonth);
  const expectedThisMonth = currentBills.reduce((acc, b) => acc + expectedFor(b), 0);
  const collectedThisMonth = currentBills.reduce((acc, b) => acc + collectedFor(b), 0);
  const depositsThisMonth = currentBills.reduce((acc, b) => acc + (b.amountPaid - collectedFor(b)), 0);

  const methodTotal = (method: Payment['method']) => {
    // Same deposit exclusion as collectedFor, applied per payment in order.
    let total = 0;
    for (const bill of currentBills) {
      let depositLeft = bill.deposit;
      for (const p of bill.payments) {
        const toDeposit = Math.min(depositLeft, p.amount);
        depositLeft -= toDeposit;
        if (p.method === method) total += p.amount - toDeposit;
      }
    }
    return total;
  };

  const inArrears = activeTenancies.filter((t) => t.balance > 0);
  const overdueTenancies = activeTenancies.filter((t) => t.overdueAmount > 0);
  const occupiedUnits = propertyViews.reduce((acc, p) => acc + p.occupied, 0);

  const stats = {
    collectedThisMonth,
    expectedThisMonth,
    collectionRate: percent(collectedThisMonth, expectedThisMonth),
    depositsThisMonth,
    mpesaTotal: methodTotal('M-Pesa'),
    bankTotal: methodTotal('Bank'),
    outstandingAmount: inArrears.reduce((acc, t) => acc + t.balance, 0),
    /** Past the grace period (after the 20th). */
    tenantsOverdueCount: overdueTenancies.length,
    overdueAmount: overdueTenancies.reduce((acc, t) => acc + t.overdueAmount, 0),
    /** Owing, but still inside the grace period or not yet due. */
    tenantsInGraceCount: inArrears.length - overdueTenancies.length,
    tenantsOwingCount: inArrears.length,
    formerTenantsOwing: formerTenancies.filter((t) => t.balance > 0).reduce((acc, t) => acc + t.balance, 0),
    occupancyRate: percent(occupiedUnits, totalUnits),
    occupiedUnits,
    totalUnits,
    depositsHeld: activeTenancies.reduce((acc, t) => acc + t.depositHeld, 0),
  };

  // Last 6 months, but never before the company joined Makazi.
  const historyStart = [addMonths(currentMonth, -5), settings.ledgerStartMonth].sort().pop()!;
  const sixMonthsHistory = monthsBetween(historyStart, currentMonth).map((month) => {
    const bills = billsIn(tenancies, month);
    const expected = bills.reduce((acc, b) => acc + expectedFor(b), 0);
    const collected = bills.reduce((acc, b) => acc + collectedFor(b), 0);
    return {
      month: shortMonthLabel(month),
      label: monthLabel(month),
      collected,
      expected,
      rate: percent(collected, expected),
      isCurrent: month === currentMonth,
    };
  });

  // ---------------------------------------------------------------------------
  // Arrears

  const arrears = [...inArrears].sort((a, b) => b.balance - a.balance);

  const AGEING_BUCKETS: Array<{ label: string; test: (s: ArrearsSlice) => boolean }> = [
    { label: 'Not yet due', test: (s) => s.stage === 'upcoming' },
    { label: `In grace period (to the ${settings.graceDay}th)`, test: (s) => s.stage === 'grace' },
    { label: '1–30 days overdue', test: (s) => s.stage === 'overdue' && s.daysOverdue <= 30 },
    { label: '31–60 days overdue', test: (s) => s.stage === 'overdue' && s.daysOverdue > 30 && s.daysOverdue <= 60 },
    { label: '60+ days overdue', test: (s) => s.stage === 'overdue' && s.daysOverdue > 60 },
  ];

  const arrearsAgeing = (() => {
    const slices = inArrears.flatMap((t) => t.arrears);
    const buckets = AGEING_BUCKETS.map(({ label, test }) => ({
      label,
      amount: slices.filter(test).reduce((acc, s) => acc + s.amount, 0),
    }));
    const max = Math.max(1, ...buckets.map((b) => b.amount));
    return buckets.map((b) => ({ ...b, percentage: Math.round((b.amount / max) * 100) }));
  })();

  function lateLabel(view: TenancyView): string {
    if (view.balance <= 0) return 'Settled';
    if (view.stage === 'overdue') {
      return `${view.daysOverdue} ${view.daysOverdue === 1 ? 'day' : 'days'} overdue`;
    }
    if (view.stage === 'grace') return `Grace period to ${settings.graceDay} ${shortMonthLabel(currentMonth)}`;
    return `Due ${settings.dueDay} ${shortMonthLabel(currentMonth)}`;
  }


  const depositSchedule = settings.depositSchedule;
  const graceDay = settings.graceDay;
  const dueDay = settings.dueDay;

  // ---------------------------------------------------------------------------
  // Leases



  const EXPIRING_WITHIN_DAYS = 60;

  const leases: LeaseView[] = tenancies.flatMap((view): LeaseView[] => {
    const t = view.tenancy;
    const term = `${formatDate(t.leaseStart)} – ${formatDate(t.leaseEnd)}`;
    if (!view.isActive) {
      return [{ leaseId: t.id, view, term, rent: t.rent, status: 'Ended', action: null, note: `moved out ${formatDate(t.moveOut!)}` }];
    }
    const out: LeaseView[] = [];
    if (t.renewal) {
      out.push({
        leaseId: t.renewal.leaseId,
        view,
        term: `${formatDate(t.renewal.start)} – ${formatDate(t.renewal.end)}`,
        rent: t.renewal.rent,
        status: 'Awaiting signature',
        action: 'Countersign',
        note: `starts ${formatDate(t.renewal.start)}`,
      });
    }
    const daysLeft = daysBetween(seed.asOf, t.leaseEnd);
    const expiring = daysLeft <= EXPIRING_WITHIN_DAYS;
    out.push({
      leaseId: t.id,
      view,
      term,
      rent: t.rent,
      status: expiring ? 'Expiring' : 'Active',
      action: expiring && !t.renewal ? 'Renew' : null,
      note: `ends ${formatDate(t.leaseEnd)}`,
    });
    return out;
  });

  const leaseStats = {
    activeCount: leases.filter((l) => l.status === 'Active').length,
    expiringCount: leases.filter((l) => l.status === 'Expiring').length,
    awaitingSignatureCount: leases.filter((l) => l.status === 'Awaiting signature').length,
  };

  const leasesNeedingAction = leases.filter((l) => l.action !== null);

  // ---------------------------------------------------------------------------
  // Bills sheet (the owner's spreadsheet)


  const allBilledMonths = tenancies.flatMap((t) => t.bills.map((b) => b.month));
  const maxBilledMonth = [currentMonth, ...allBilledMonths].sort().pop()!;
  const billMonths: Month[] = monthsBetween(settings.ledgerStartMonth, maxBilledMonth).reverse();

  const billRows: BillRow[] = tenancies
    .flatMap((view) => view.bills.map((bill) => ({ month: bill.month, view, bill })))
    .sort(
      (a, b) =>
        a.view.property.name.localeCompare(b.view.property.name) ||
        a.view.unit.label.localeCompare(b.view.unit.label, undefined, { numeric: true }),
    );

  /** The latest meter reading per unit, for the readings form. */
  function lastReading(unitId: string): { month: Month; value: number } {
    const readings = seed.meterReadings[unitId] ?? {};
    const months = Object.keys(readings).sort();
    const month = months.pop();
    if (!month) {
      const t = seed.tenancies.find((ten) => ten.unitId === unitId);
      return { month: t ? monthOf(t.moveIn) : currentMonth, value: t?.openingReading ?? 0 };
    }
    return { month, value: readings[month] };
  }



  // ---------------------------------------------------------------------------
  // Staff, repairs and messages (same records the tenant app reads)

  const staffById = new Map(seed.staff.map((s) => [s.id, s]));



  const tenancyById = new Map(tenancies.map((t) => [t.tenancy.id, t]));

  const tickets: TicketView[] = seed.repairTickets
    .map((ticket) => {
      const view = tenancyById.get(ticket.tenancyId)!;
      return {
        ticket,
        view,
        categoryLabel: REPAIR_CATEGORY_LABELS[ticket.category],
        priorityLabel: REPAIR_PRIORITY_LABELS[ticket.priority],
        statusLabel: REPAIR_STATUS_LABELS[ticket.status],
        reporter: `${view.tenant.name} · ${view.unitLabel}`,
        when: whenLabel(ticket.resolvedAt ?? ticket.createdAt),
      };
    })
    .sort((a, b) => b.ticket.createdAt.localeCompare(a.ticket.createdAt));

  const repairBoard = {
    open: tickets.filter((t) => t.ticket.status === 'open'),
    inProgress: tickets.filter((t) => t.ticket.status === 'in_progress'),
    resolved: tickets.filter((t) => t.ticket.status === 'resolved'),
  };

  const repairStats = {
    /** Open and in progress. */
    openCount: repairBoard.open.length + repairBoard.inProgress.length,
    highPriorityOpen: [...repairBoard.open, ...repairBoard.inProgress].filter((t) => t.ticket.priority === 'high').length,
  };


  const threads: ThreadView[] = [...new Set(seed.messages.map((m) => m.tenancyId))]
    .map((tenancyId) => {
      const messages = seed.messages
        .filter((m) => m.tenancyId === tenancyId)
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
      return {
        view: tenancyById.get(tenancyId)!,
        messages,
        last: messages[messages.length - 1],
        unread: messages.filter((m) => m.sender === 'tenant' && m.readByStaffAt === null).length,
      };
    })
    .sort((a, b) => b.last.sentAt.localeCompare(a.last.sentAt));

  const unreadThreadCount = threads.filter((t) => t.unread > 0).length;

  // Makazi plan usage (catered for; not enforced or billed yet).
  const plan = {
    ...company.subscription,
    unitsUsed: seed.units.length,
    staffUsed: seed.staff.length,
  };

  // A new company's first steps; the overview shows these until bills exist.
  const gettingStarted = {
    hasProperties: seed.properties.length > 0,
    hasTenants: seed.tenancies.length > 0,
    hasBills: tenancies.some((t) => t.bills.length > 0),
  };

  return {
    gettingStarted,
    asOf,
    currentMonth,
    currentPeriod,
    whenLabel,
    seed,
    company,
    plan,
    tenancies,
    activeTenancies,
    formerTenancies,
    propertyViews,
    portfolioSummary,
    payments,
    stats,
    sixMonthsHistory,
    arrears,
    arrearsAgeing,
    lateLabel,
    depositSchedule,
    graceDay,
    dueDay,
    leases,
    leaseStats,
    leasesNeedingAction,
    billMonths,
    billRows,
    lastReading,
    staffById,
    tickets,
    repairBoard,
    repairStats,
    threads,
    unreadThreadCount,
  };
}

export type Portfolio = ReturnType<typeof buildPortfolio>;

// Seed-mode cache (not used in Supabase mode — live data is always fresh).
let demoWarned = false;
const seedCache = new Map<string, Portfolio>();

// Live Supabase cache: short TTL and inflight request deduplication for SSR components
interface LiveCacheEntry {
  portfolio: Portfolio;
  expiresAt: number;
}
const liveCache = new Map<string, LiveCacheEntry>();
const liveInflight = new Map<string, Promise<Portfolio>>();
// Bumped on every write, so a fetch that started before the write can't put
// its older result back into the cache.
const liveGeneration = new Map<string, number>();

export function clearLiveCache(companyId?: string) {
  const ids = companyId ? [companyId] : [...new Set([...liveCache.keys(), ...liveInflight.keys()])];
  for (const id of ids) {
    liveCache.delete(id);
    liveInflight.delete(id);
    liveGeneration.set(id, (liveGeneration.get(id) ?? 0) + 1);
  }
}

/**
 * Everything the admin shows for one company.
 *
 * Phase 1 (seed mode): called synchronously via the JSON seed.
 * Phase 2 (Supabase mode): fetches live data; pass `cookies` from Astro.cookies
 * so the RLS-scoped client is created for the current request.
 *
 * All callers must `await` this function.
 */
export async function getPortfolio(
  companyId: string,
  cookies?: AstroCookies,
): Promise<Portfolio> {
  // Phase 2: Supabase is configured → fetch live data.
  if (supabaseConfigured()) {
    const cached = liveCache.get(companyId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.portfolio;
    }

    const inflight = liveInflight.get(companyId);
    if (inflight) {
      return inflight;
    }

    const supabase = makeSupabaseClient(cookies);
    if (supabase) {
      const generation = liveGeneration.get(companyId) ?? 0;
      const fetchPromise = (async () => {
        try {
          const liveSeed = await fetchSeedFromSupabase(supabase, companyId);
          const portfolio = buildPortfolio(companyId, liveSeed);
          if ((liveGeneration.get(companyId) ?? 0) === generation) {
            liveCache.set(companyId, {
              portfolio,
              expiresAt: Date.now() + 3000, // 3-second TTL for fast responsive page loads
            });
          }
          return portfolio;
        } finally {
          if (liveInflight.get(companyId) === fetchPromise) liveInflight.delete(companyId);
        }
      })();

      liveInflight.set(companyId, fetchPromise);
      return fetchPromise;
    }
  }

  // Phase 1 (no Supabase in .env): the JSON demo seed, cached per company.
  // Never used once Supabase is configured: a failed fetch is an error page,
  // not someone else's demo numbers.
  if (!demoWarned) {
    demoWarned = true;
    console.warn('[Makazi] Supabase is not configured: showing DEMO data from shared/billing-seed.json.');
  }
  let portfolio = seedCache.get(companyId);
  if (!portfolio) {
    portfolio = buildPortfolio(companyId);
    seedCache.set(companyId, portfolio);
  }
  return portfolio;
}

export { addMonths };
