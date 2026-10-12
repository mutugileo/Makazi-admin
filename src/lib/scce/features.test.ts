import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Payment, Seed } from '../billing';
import { portfolioMonths, scceSharingOf } from './features';

const pay = (tenancyId: string, amount: number, date: string, method: Payment['method'] = 'M-Pesa', simulated = false) =>
  ({ receiptNumber: `RCT-${tenancyId}-${date}`, tenancyId, amount, date, time: '10:00', method, reference: 'X', simulated }) as Payment;

const tenancy = (id: string, unitId: string, rent: number, moveIn: string, moveOut: string | null = null, deposit = 0) => ({
  id, tenantId: `tn-${id}`, unitId, rent, deposit, moveIn, moveOut, leaseStart: moveIn, leaseEnd: '2027-12-31',
  openingBalance: 0, openingReading: null, renewal: null, moveOutNote: null, depositRefund: null,
});

// One landlord, three one-bedroom units, rent and garbage only (no meter readings).
const seed: Seed = {
  asOf: '2026-10-12',
  companies: [{
    id: 'acme', slug: 'acme', name: 'Acme Homes', kraPin: 'P051234567X', mpesaPaybill: '123456', bankName: 'KCB', bankAccount: '1234567',
    settings: { ledgerStartMonth: '2026-01', dueDay: 5, graceDay: 20, depositSchedule: { '1': 25000 }, recordRetentionMonths: 6 },
    sequences: { receipt: 0, repairTicket: 0 },
    subscription: { plan: 'growth', status: 'active', unitLimit: 100, staffLimit: 10, trialEndsAt: null },
  }],
  properties: [{
    id: 'p1', companyId: 'acme', managerId: 's1', name: 'Acme Court', type: 'apartments', address: 'Kilimani', accountPrefix: 'AC',
    waterRate: 150, garbageFee: 250, rateHistory: [{ from: '2026-01', waterRate: 150, garbageFee: 250 }],
  }],
  units: ['u1', 'u2', 'u3'].map((id) => ({ id, propertyId: 'p1', label: id.toUpperCase(), bedrooms: 1 })),
  tenants: [],
  tenancies: [
    tenancy('t1', 'u1', 20000, '2025-06-01', '2026-04-15'),
    tenancy('t2', 'u2', 30000, '2025-01-01'),
    tenancy('t3', 'u3', 25000, '2026-03-16', null, 25000),
  ],
  meterReadings: {},
  payments: [
    ...['01', '02', '03', '04'].map((m) => pay('t1', 20250, `2026-${m}-03`)),
    pay('t2', 30250, '2026-01-04', 'Bank'),
    pay('t2', 30250, '2026-03-10', 'M-Pesa', true), // test mode: no money moved
    pay('t3', 38153, '2026-03-16'),
  ],
  staff: [],
  repairTickets: [
    { id: 'MT-1', companyId: 'acme', tenancyId: 't2', unitId: 'u2', category: 'plumbing', priority: 'medium', status: 'resolved',
      title: 'Leak', description: '', hasPhoto: false, createdAt: '2026-02-25T09:00:00+03:00', resolvedAt: '2026-03-10T12:00:00+03:00',
      assignedTo: null, resolutionNote: null },
    { id: 'MT-2', companyId: 'acme', tenancyId: 't1', unitId: 'u1', category: 'electrical', priority: 'high', status: 'resolved',
      title: 'Socket', description: '', hasPhoto: false, createdAt: '2026-03-02T09:00:00+03:00', resolvedAt: '2026-03-06T15:00:00+03:00',
      assignedTo: null, resolutionNote: null },
  ],
  messages: [],
};

test('skips months before the company joined Makazi', () => {
  const months = portfolioMonths(seed, 'acme', '2025-11', '2026-03');
  assert.deepEqual(months.map((m) => m.month), ['2026-01', '2026-02', '2026-03']);
});

test('March: collections exclude deposits and test payments; arrears age from the grace day', () => {
  const [march] = portfolioMonths(seed, 'acme', '2026-03', '2026-03');
  // t3 moves in on the 16th: rent 25,000 x 16/31 = 12,903, plus garbage 250.
  // Billed = 20,250 + 30,250 + 13,153 = 63,653
  assert.equal(march.billedKes, 63_653);
  assert.equal(march.rentBilledKes, 20_000 + 30_000 + 12_903);
  // Collected = t1 20,250 + t3 (38,153 - 25,000 deposit) = 33,403. t2's test payment counts for nothing.
  assert.equal(march.collectedKes, 33_403);
  assert.equal(march.mpesaCollectedKes, 33_403);
  assert.equal(march.testPaymentsExcluded, 1);
  // t2 owes February and March (2 x 30,250). February's grace ended 20 Feb: 39 days by 31 Mar.
  assert.equal(march.arrearsKes, 60_500);
  assert.equal(march.arrearsOver30Kes, 30_250);
  assert.equal(march.arrearsOver90Kes, 0);
  assert.equal(march.tenanciesOver30, 1);
  // Occupancy: 31 + 31 + 16 unit-days of 3 x 31.
  assert.equal(march.occupiedUnits, 3);
  assert.equal(march.occupiedUnitDays, 78);
  assert.equal(march.unitDays, 93);
  assert.equal(march.moveIns, 1);
  assert.equal(march.moveOuts, 0);
  // Repairs resolved in March took 13 and 4 days.
  assert.equal(march.repairsOpened, 1);
  assert.equal(march.repairsResolved, 2);
  assert.equal(march.repairDaysMedian, 8.5);
});

test('April: a mid-month move-out frees the unit from the move-out day', () => {
  const [april] = portfolioMonths(seed, 'acme', '2026-04', '2026-04');
  assert.equal(april.moveOuts, 1);
  assert.equal(april.occupiedUnits, 2);
  assert.equal(april.activeTenancies, 2);
  // u1 is occupied 1 to 14 April; u2 and u3 all 30 days.
  assert.equal(april.occupiedUnitDays, 14 + 30 + 30);
});

test('sharing is off unless the owner turned it on', () => {
  assert.equal(scceSharingOf(seed.companies[0]).enabled, false);
  const on = { settings: { ...seed.companies[0].settings, scce: { enabled: true, enabledAt: '2026-10-12T08:00:00Z', enabledBy: 'o@acme.co.ke' } } };
  assert.deepEqual(scceSharingOf(on), { enabled: true, enabledAt: '2026-10-12T08:00:00Z', enabledBy: 'o@acme.co.ke', disabledAt: null });
});
