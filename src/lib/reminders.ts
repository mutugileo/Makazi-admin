// Payment reminder wording, shared by the Send reminders preview and the
// notification the tenant actually receives, so the two can't drift.

import { formatKes } from './billing';

export interface ReminderInput {
  tenantName: string;
  balance: number;
  accountNumber: string;
  accountName?: string | null;
  companyName: string;
  mpesaPaybill: string;
  graceDay: number;
  /** Today in Nairobi, YYYY-MM-DD. */
  asOf: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function paymentReminder(r: ReminderInput): { title: string; body: string } {
  const firstName = r.tenantName.split(' ')[0];
  const day = Number(r.asOf.slice(8, 10));
  const month = MONTHS[Number(r.asOf.slice(5, 7)) - 1];
  // Past the grace day a "pay by" date would already be behind them.
  const when = day <= r.graceDay ? `Please pay by ${r.graceDay} ${month}` : 'Please pay as soon as you can';
  const accountLabel = r.accountName ? `${r.accountNumber} (${r.accountName})` : r.accountNumber;
  return {
    title: `Payment reminder from ${r.companyName}`,
    body:
      `Habari ${firstName}, your balance is ${formatKes(r.balance)} ` +
      `(rent, water, garbage and any unpaid amount from earlier months). ` +
      `${when} via M-Pesa Paybill ${r.mpesaPaybill}, Account ${accountLabel}.`,
  };
}
