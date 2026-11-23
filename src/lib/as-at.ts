// The company as it stood at the end of a month. Used by the overview's month
// picker and by the SCCE export, so both see the same past.

import type { Month, Seed } from './billing';

/**
 * Payments made by the month's last day, tenancies that had started,
 * move-outs that hadn't happened yet, and meter readings up to that month.
 * The billing engine then gives that month's bills, collections and arrears.
 */
export function seedAsAt(seed: Seed, month: Month): Seed {
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
