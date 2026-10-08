// Reports: the company's history over a range of months, from the same
// billing engine and portfolio as every other admin page, so the numbers on
// Reports always agree with the overview, Bills and Arrears.

import {
  addMonths,
  collectedFor,
  expectedFor,
  monthLabel,
  REPAIR_CATEGORY_LABELS,
  type Month,
  type MonthlyBill,
} from '../lib/billing';
import type { Portfolio } from './portfolio';

export type ReportRange = '6' | '12' | 'all';

export const REPORT_RANGES: Array<{ value: ReportRange; label: string }> = [
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
  { value: 'all', label: 'All time' },
];

export function reportRangeFrom(url: URL): ReportRange {
  const range = url.searchParams.get('range');
  return range === '6' || range === 'all' ? range : '12';
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortMonth = (m: Month) => SHORT[Number(m.slice(5, 7)) - 1];

function lastDayOf(month: Month): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Collected in a bill by method, leaving out what paid the deposit (as collectedFor). */
function collectedByMethod(bill: MonthlyBill) {
  let depositLeft = bill.deposit;
  let mpesa = 0;
  let bank = 0;
  for (const p of bill.payments) {
    const toDeposit = Math.min(depositLeft, p.amount);
    depositLeft -= toDeposit;
    if (p.method === 'M-Pesa') mpesa += p.amount - toDeposit;
    else bank += p.amount - toDeposit;
  }
  return { mpesa, bank };
}

export function buildReports(p: Portfolio, range: ReportRange) {
  const start = p.company.settings.ledgerStartMonth;
  const first =
    range === 'all' ? start : [addMonths(p.currentMonth, -(Number(range) - 1)), start].sort().pop()!;
  const months: Month[] = [];
  for (let m = first; m <= p.currentMonth; m = addMonths(m, 1)) months.push(m);

  const allBills = p.tenancies.flatMap((t) => t.bills);
  const totalUnits = p.stats.totalUnits;

  const monthly = months.map((month) => {
    const bills = allBills.filter((b) => b.month === month);
    const billed = bills.reduce((acc, b) => acc + expectedFor(b), 0);
    const collected = bills.reduce((acc, b) => acc + collectedFor(b), 0);
    const split = bills.map(collectedByMethod).reduce((a, b) => ({ mpesa: a.mpesa + b.mpesa, bank: a.bank + b.bank }), { mpesa: 0, bank: 0 });
    const monthEnd = lastDayOf(month);
    // This month counts units let the way the overview does (a signed tenant
    // moving in on the 1st already holds the unit); earlier months count who
    // was living there at month end.
    const occupied =
      month === p.currentMonth
        ? p.stats.occupiedUnits
        : p.tenancies.filter(
            (t) => t.tenancy.moveIn <= monthEnd && (!t.tenancy.moveOut || t.tenancy.moveOut > monthEnd),
          ).length;
    return {
      month,
      short: shortMonth(month),
      label: monthLabel(month),
      isCurrent: month === p.currentMonth,
      billed,
      collected,
      rate: percent(collected, billed),
      mpesa: split.mpesa,
      bank: split.bank,
      occupied,
      occupancyRate: percent(occupied, totalUnits),
      moveIns: p.tenancies.filter((t) => t.tenancy.moveIn.startsWith(month)).length,
      moveOuts: p.tenancies.filter((t) => t.tenancy.moveOut?.startsWith(month)).length,
    };
  });

  const inRange = (isoOrDate: string) => isoOrDate.slice(0, 7) >= first && isoOrDate.slice(0, 7) <= p.currentMonth;

  const byProperty = p.propertyViews
    .map((pv) => {
      const bills = p.tenancies
        .filter((t) => t.property.id === pv.property.id)
        .flatMap((t) => t.bills)
        .filter((b) => months.includes(b.month));
      const billed = bills.reduce((acc, b) => acc + expectedFor(b), 0);
      const collected = bills.reduce((acc, b) => acc + collectedFor(b), 0);
      return { name: pv.property.name, billed, collected, rate: percent(collected, billed), units: pv.units.length, occupied: pv.occupied };
    })
    .sort((a, b) => b.rate - a.rate || b.billed - a.billed);

  const tickets = p.tickets.filter((t) => inRange(t.ticket.createdAt));
  const resolved = p.tickets.filter((t) => t.ticket.resolvedAt && inRange(t.ticket.resolvedAt));
  const daysToFix = resolved.map(
    (t) => (Date.parse(t.ticket.resolvedAt!) - Date.parse(t.ticket.createdAt)) / 86_400_000,
  );
  const repairsByCategory = Object.entries(REPAIR_CATEGORY_LABELS)
    .map(([key, label]) => ({ key, label, count: tickets.filter((t) => t.ticket.category === key).length }))
    .sort((a, b) => b.count - a.count);

  const totals = monthly.reduce(
    (acc, m) => ({ billed: acc.billed + m.billed, collected: acc.collected + m.collected, mpesa: acc.mpesa + m.mpesa, bank: acc.bank + m.bank }),
    { billed: 0, collected: 0, mpesa: 0, bank: 0 },
  );

  return {
    range,
    months,
    rangeLabel: months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`,
    monthly,
    totals: { ...totals, rate: percent(totals.collected, totals.billed) },
    byProperty,
    ageing: p.arrearsAgeing,
    outstanding: p.stats.outstandingAmount,
    tenantsOwing: p.stats.tenantsOwingCount,
    occupancy: { rate: p.stats.occupancyRate, occupied: p.stats.occupiedUnits, total: totalUnits },
    repairs: {
      opened: tickets.length,
      resolved: resolved.length,
      open: p.repairStats.openCount,
      avgDaysToFix: daysToFix.length ? Math.round((daysToFix.reduce((a, b) => a + b, 0) / daysToFix.length) * 10) / 10 : null,
      byCategory: repairsByCategory,
    },
  };
}

export type Reports = ReturnType<typeof buildReports>;
