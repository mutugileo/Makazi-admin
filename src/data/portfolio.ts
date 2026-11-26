// Admin view models, built from the company's live Supabase data (see
// src/lib/supabase-data.ts) by the billing engine.  Every money figure on every admin page comes through here so
// the admin and the tenant app always agree.

import { supabaseConfigured, makeSupabaseClient } from '../lib/supabase';
import { fetchSeedFromSupabase } from '../lib/supabase-data';
import type { AstroCookies } from 'astro';
import {
  addMonths,
  addMonthsToDate,
  arrearsSlices,
  buildLedger,
  ledgerStartFor,
  allocateBill,
  collectedFor,
  collectedByPayment,
  daysBetween,
  expectedFor,
  formatDate,
  cycleOf,
  monthLabel,
  monthsBetween,
  ordinal,
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

export interface TenancyView {
  tenancy: Tenancy;
  tenant: Tenant;
  unit: Unit;
  property: Property;
  bills: MonthlyBill[];
  currentBill: MonthlyBill | null;
  balance: number;
  status: BillStatus;
  isActive: boolean;
  accountNumber: string;
  unitLabel: string;
  arrears: ArrearsSlice[];
  overdueAmount: number;
  daysOverdue: number;
  stage: ArrearsStage | null;
  recordsKeptUntil: string | null;
  depositHeld: number;
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

function buildPortfolio(companyId: string, baseSeed: Seed) {
  const seed = scopeSeed(baseSeed, companyId);
  const asOf = seed.asOf;
  const currentMonth: Month = cycleOf(asOf);
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
    // Only needed when there are no bills yet.
    const balance = last
      ? last.outstanding
      : cycleOf(seed.asOf) >= ledgerStartFor(seed, tenancy)
        ? tenancy.openingBalance
        : 0;
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

  const allBilledMonths = tenancies.flatMap((t) => t.bills.map((b) => b.month));
  const maxBilledMonth = [currentMonth, ...allBilledMonths].sort().pop()!;

  // ---------------------------------------------------------------------------
  // Properties & units



  const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const billsIn = (views: TenancyView[], month: Month) =>
    views.flatMap((v) => v.bills.filter((b) => b.month === month));

  // Grouped once, in seed order, so each property and unit reads its own list.
  const groupBy = <T,>(items: readonly T[], key: (item: T) => string) => {
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const k = key(item);
      const list = groups.get(k);
      if (list) list.push(item);
      else groups.set(k, [item]);
    }
    return groups;
  };
  const unitsByProperty = groupBy(seed.units, (u) => u.propertyId);
  const tenanciesByUnit = groupBy(tenancies, (t) => t.unit.id);
  const tenanciesByProperty = groupBy(tenancies, (t) => t.property.id);

  const propertyViews: PropertyView[] = seed.properties.map((property) => {
    const units = (unitsByProperty.get(property.id) ?? [])
      .map((unit) => {
        const history = tenanciesByUnit.get(unit.id) ?? [];
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

    const monthBills = billsIn(tenanciesByProperty.get(property.id) ?? [], currentMonth);
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


  // Tenancy ids are primary keys, so first and last match are the same record.
  const tenancyById = new Map(tenancies.map((t) => [t.tenancy.id, t]));

  // The bill the engine counted each payment against, first bill first (a
  // payment made ahead of the first bill counts towards that bill, not its own
  // month's). Keyed per tenancy, as the lookup only ever searched its own bills.
  const billByReceipt = new Map<string, MonthlyBill>();
  for (const view of tenancies) {
    for (const bill of view.bills) {
      for (const p of bill.payments) {
        const key = `${view.tenancy.id}\u0000${p.receiptNumber}`;
        if (!billByReceipt.has(key)) billByReceipt.set(key, bill);
      }
    }
  }

  const payments: PaymentView[] = seed.payments
    .map((payment) => {
      const view = tenancyById.get(payment.tenancyId)!;
      const bill = billByReceipt.get(`${view.tenancy.id}\u0000${payment.receiptNumber}`);
      return {
        payment,
        view,
        forDescription: bill ? receiptDescription(bill, payment) : 'Payment',
        dateLabel: formatDate(payment.date),
      };
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
    // Same deposit exclusion as collectedFor, per payment.
    let total = 0;
    for (const bill of currentBills) {
      for (const { payment, amount } of collectedByPayment(bill)) {
        if (payment.method === method) total += amount;
      }
    }
    return total;
  };

  // Rent, water and garbage billed this cycle against what covered them
  // (allocateBill: arrears brought forward first, then shared proportionally).
  const categoryCollections = (() => {
    const zero = () => ({ billed: 0, paid: 0 });
    const lines = { rent: zero(), water: zero(), garbage: zero() };
    const arrears = { broughtForward: 0, paid: 0 };
    for (const bill of currentBills) {
      const a = allocateBill(bill);
      for (const k of ['rent', 'water', 'garbage'] as const) {
        lines[k].billed += a.billed[k];
        lines[k].paid += a.paid[k];
      }
      arrears.broughtForward += a.arrearsBf;
      arrears.paid += a.arrearsPaid;
    }
    const billed = lines.rent.billed + lines.water.billed + lines.garbage.billed;
    const paid = lines.rent.paid + lines.water.paid + lines.garbage.paid;
    return { lines, arrears, billed, paid, rate: percent(paid, billed) };
  })();

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
  const historyEnd = maxBilledMonth;
  const historyStart = [addMonths(historyEnd, -5), settings.ledgerStartMonth].sort().pop()!;
  const sixMonthsHistory = monthsBetween(historyStart, historyEnd).map((month) => {
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
    { label: `In grace period (to the ${ordinal(settings.graceDay)})`, test: (s) => s.stage === 'grace' },
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

  const billMonths: Month[] = monthsBetween(settings.ledgerStartMonth, maxBilledMonth).reverse();

  const billRows: BillRow[] = tenancies
    .flatMap((view) => view.bills.map((bill) => ({ month: bill.month, view, bill })))
    .sort(
      (a, b) =>
        a.view.property.name.localeCompare(b.view.property.name) ||
        a.view.unit.label.localeCompare(b.view.unit.label, undefined, { numeric: true }),
    );

  /** The first tenancy recorded per unit (what a find over seed.tenancies returned). */
  const firstTenancyByUnit = new Map<string, Tenancy>();
  for (const t of seed.tenancies) if (!firstTenancyByUnit.has(t.unitId)) firstTenancyByUnit.set(t.unitId, t);

  /** The latest meter reading per unit, for the readings form. */
  function lastReading(unitId: string): { month: Month; value: number } {
    const readings = seed.meterReadings[unitId] ?? {};
    const months = Object.keys(readings).sort();
    const month = months.pop();
    if (!month) {
      const t = firstTenancyByUnit.get(unitId);
      return { month: t ? cycleOf(t.moveIn) : currentMonth, value: t?.openingReading ?? 0 };
    }
    return { month, value: readings[month] };
  }



  // ---------------------------------------------------------------------------
  // Staff, repairs and messages (same records the tenant app reads)

  const staffById = new Map(seed.staff.map((s) => [s.id, s]));


  const tickets: TicketView[] = seed.repairTickets
    .map((ticket) => {
      const view = tenancyById.get(ticket.tenancyId);
      if (!view) return null;
      return {
        ticket,
        view,
        categoryLabel: REPAIR_CATEGORY_LABELS[ticket.category] ?? ticket.category,
        priorityLabel: REPAIR_PRIORITY_LABELS[ticket.priority] ?? ticket.priority,
        statusLabel: REPAIR_STATUS_LABELS[ticket.status] ?? ticket.status,
        reporter: `${view.tenant.name} · ${view.unitLabel}`,
        when: whenLabel(ticket.resolvedAt ?? ticket.createdAt),
      };
    })
    .filter((t): t is TicketView => t !== null)
    .sort((a, b) => b.ticket.createdAt.localeCompare(a.ticket.createdAt));

  const repairBoard = {
    open: tickets.filter((t) => t.ticket.status === 'open'),
    inProgress: tickets.filter((t) => t.ticket.status === 'in_progress'),
    resolved: tickets.filter((t) => t.ticket.status === 'resolved'),
    voided: tickets.filter((t) => t.ticket.status === 'voided'),
  };

  const repairStats = {
    /** Open and in progress. */
    openCount: repairBoard.open.length + repairBoard.inProgress.length,
    highPriorityOpen: [...repairBoard.open, ...repairBoard.inProgress].filter((t) => t.ticket.priority === 'high').length,
  };


  // Map keys keep first-seen order, the same as the Set of tenancy ids did.
  const messagesByTenancy = groupBy(seed.messages, (m) => m.tenancyId);
  const threads: ThreadView[] = [...messagesByTenancy.keys()]
    .map((tenancyId) => {
      const view = tenancyById.get(tenancyId);
      if (!view) return null;
      const messages = [...messagesByTenancy.get(tenancyId)!]
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
      return {
        view,
        messages,
        last: messages[messages.length - 1],
        unread: messages.filter((m) => m.sender === 'tenant' && m.readByStaffAt === null).length,
      };
    })
    .filter((t): t is ThreadView => t !== null)
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
    /** True when built as at the end of an earlier month (overview filter). */
    isPastMonth: false,
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
    categoryCollections,
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

const LIVE_CACHE_TTL_MS = 30_000;
// startedAt: when the fetch behind the entry began; the data is at least that fresh.
const liveCache = new Map<string, { portfolio: Portfolio; expiresAt: number; startedAt: number }>();
// Live Supabase inflight request deduplication for SSR components
const liveInflight = new Map<string, { promise: Promise<Portfolio>; startedAt: number }>();
// Bumped on every write, so a fetch that started before the write can't put
// its older result back into the cache.
const liveGeneration = new Map<string, number>();

export function clearLiveCache(companyId?: string) {
  const ids = companyId
    ? [companyId]
    : [...new Set([...liveCache.keys(), ...liveInflight.keys()])];
  for (const id of ids) {
    liveCache.delete(id);
    liveInflight.delete(id);
    liveGeneration.set(id, (liveGeneration.get(id) ?? 0) + 1);
  }
}

// ---------------------------------------------------------------------------
// Freshness across server instances
//
// clearLiveCache only empties this instance's cache. A write handled by one
// Vercel instance leaves up to 30s of older data cached on the others, so the
// writer's next page could show the record missing. markFresh(cookies) puts
// the write time in a short-lived cookie; while it is set, any instance
// skips a cached (or in-flight) portfolio fetched before that time.

const FRESH_COOKIE = 'mk_fresh';
// Longer than the cache TTL: after that every older entry has expired anyway.
const FRESH_COOKIE_SECONDS = 60;
// Allowance for clock differences between instances.
const CLOCK_SKEW_MS = 1_000;

/** Call after a successful write (alongside clearLiveCache) so the user's next pages skip older caches on every instance. */
export function markFresh(cookies: AstroCookies): void {
  cookies.set(FRESH_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
    path: '/',
    maxAge: FRESH_COOKIE_SECONDS,
  });
}

/** Cached data must have been fetched at or after this time, or 0 for no requirement. */
function freshAfter(cookies: AstroCookies | undefined, now: number): number {
  const raw = cookies?.get(FRESH_COOKIE)?.value;
  if (!raw || !/^\d{1,16}$/.test(raw)) return 0;
  const writtenAt = Number(raw);
  // A future or stale stamp (a hand-edited cookie) asks for nothing, so it
  // can't switch the cache off.
  if (writtenAt > now + CLOCK_SKEW_MS || writtenAt < now - FRESH_COOKIE_SECONDS * 1000) return 0;
  return writtenAt + CLOCK_SKEW_MS;
}

/**
 * Everything the admin shows for one company.
 *
 * Fetches live data (cached 30s per instance); pass `cookies` from
 * Astro.cookies so the RLS-scoped client is created for the current request
 * and a recent write (markFresh) is honoured.
 *
 * All callers must `await` this function.
 */
export async function getPortfolio(
  companyId: string,
  cookies?: AstroCookies,
  month?: Month | null,
): Promise<Portfolio> {
  const current = await getCurrentPortfolio(companyId, cookies);
  if (!month || month >= current.currentMonth || month < current.company.settings.ledgerStartMonth) {
    return current;
  }
  return monthView(current, companyId, month);
}

/** ?month=YYYY-MM from the overview's month picker, or null. */
export function viewMonthFrom(url: URL): Month | null {
  const month = url.searchParams.get('month');
  return month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
}

/** Months the overview can show, newest first: this one back to the ledger start (2 years at most). */
export function selectableMonths(portfolio: Portfolio): Month[] {
  const start = portfolio.company.settings.ledgerStartMonth;
  const latest = [portfolio.currentMonth, ...portfolio.billMonths].sort().pop()!;
  const months: Month[] = [];
  for (let m = latest; m >= start && months.length < 24; m = addMonths(m, -1)) months.push(m);
  return months;
}

/**
 * The company as it stood at the end of an earlier month: payments made by
 * then, tenancies that had started, move-outs that hadn't happened yet. The
 * billing engine then gives that month's bills, collections and arrears.
 * Built from the cached current data, once per month per fetch.
 */
const monthViews = new WeakMap<Portfolio, Map<Month, Portfolio>>();

function monthView(current: Portfolio, companyId: string, month: Month): Portfolio {
  let views = monthViews.get(current);
  if (!views) monthViews.set(current, (views = new Map()));
  const cached = views.get(month);
  if (cached) return cached;
  const view = { ...buildPortfolio(companyId, seedAsAt(current.seed, month)), isPastMonth: true };
  views.set(month, view);
  return view;
}

function seedAsAt(seed: Seed, month: Month): Seed {
  const [y, m] = month.split('-').map(Number);
  const asOf = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const endOfDay = `${asOf}T23:59:59+03:00`;
  return {
    ...seed,
    asOf,
    tenancies: seed.tenancies
      .filter((t) => t.moveIn <= asOf)
      .map((t) =>
        t.moveOut && t.moveOut > asOf ? { ...t, moveOut: null, moveOutNote: null, depositRefund: null } : t,
      ),
    payments: seed.payments.filter((p) => p.date <= asOf),
    meterReadings: Object.fromEntries(
      Object.entries(seed.meterReadings).map(([unitId, byMonth]) => [
        unitId,
        Object.fromEntries(Object.entries(byMonth).filter(([readingMonth]) => readingMonth <= month)),
      ]),
    ),
    repairTickets: seed.repairTickets.filter((t) => t.createdAt <= endOfDay),
    messages: seed.messages.filter((msg) => msg.sentAt <= endOfDay),
  };
}

async function getCurrentPortfolio(
  companyId: string,
  cookies?: AstroCookies,
): Promise<Portfolio> {
  // Phase 2: Supabase is configured → fetch live data.
  if (supabaseConfigured()) {
    const now = Date.now();
    const mustStartAfter = freshAfter(cookies, now);

    const cachedMem = liveCache.get(companyId);
    if (cachedMem && cachedMem.expiresAt > now && cachedMem.startedAt >= mustStartAfter) {
      return cachedMem.portfolio;
    }

    const inflight = liveInflight.get(companyId);
    if (inflight && inflight.startedAt >= mustStartAfter) {
      return inflight.promise;
    }

    const supabase = makeSupabaseClient(cookies);
    if (supabase) {
      const generation = liveGeneration.get(companyId) ?? 0;
      const startedAt = now;
      // Assigned below; the finally block only runs after the assignment.
      let entry!: { promise: Promise<Portfolio>; startedAt: number };
      const fetchPromise = (async () => {
        try {
          const liveSeed = await fetchSeedFromSupabase(supabase, companyId);
          const portfolio = buildPortfolio(companyId, liveSeed);
          const existing = liveCache.get(companyId);
          // Never replace a newer entry with an older fetch that finished later.
          if (
            (liveGeneration.get(companyId) ?? 0) === generation &&
            (!existing || existing.startedAt <= startedAt)
          ) {
            liveCache.set(companyId, { portfolio, expiresAt: Date.now() + LIVE_CACHE_TTL_MS, startedAt });
          }
          return portfolio;
        } finally {
          if (liveInflight.get(companyId) === entry) liveInflight.delete(companyId);
        }
      })();
      entry = { promise: fetchPromise, startedAt };

      liveInflight.set(companyId, entry);
      return fetchPromise;
    }

    throw new Error(`Database connection unavailable for company ${companyId}. Demo data fallback is disabled.`);
  }

  throw new Error(`Database is required. Demo mock seeds have been removed.`);
}

export { addMonths };
