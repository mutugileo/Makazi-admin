import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  buildLedger,
  collectedByPayment,
  collectedFor,
  cycleOf,
  FIRST_CYCLE_ON_START_DAY,
  ordinal,
  statusFor,
  type MonthlyBill,
  type Payment,
  type Seed,
  type Tenancy,
} from '../src/lib/billing.ts';

// ---------------------------------------------------------------------------
// Small hand-built seeds. One company, one property, one unit.

function seed(overrides: Partial<Seed> = {}): Seed {
  return {
    asOf: '2026-11-20',
    companies: [
      {
        id: 'c1',
        slug: 'test',
        name: 'Test Lettings',
        kraPin: '',
        mpesaPaybill: '',
        bankName: '',
        bankAccount: '',
        settings: { ledgerStartMonth: '2026-09', dueDay: 5, graceDay: 10, depositSchedule: {}, recordRetentionMonths: 12 },
        sequences: { receipt: 0, repairTicket: 0 },
        subscription: { plan: 'starter', status: 'active', unitLimit: 10, staffLimit: 2, trialEndsAt: null },
      },
    ],
    properties: [
      {
        id: 'p1',
        companyId: 'c1',
        managerId: 's1',
        name: 'Block A',
        type: 'apartments',
        address: '',
        accountPrefix: 'BA',
        waterRate: 100,
        garbageFee: 500,
        rateHistory: [{ from: '2026-01', waterRate: 100, garbageFee: 500 }],
      },
    ],
    units: [{ id: 'u1', propertyId: 'p1', label: 'A1', bedrooms: 1 }],
    tenants: [{ id: 't1', companyId: 'c1', name: 'Tenant', phone: '0712000000', email: '' }],
    tenancies: [],
    meterReadings: {},
    payments: [],
    staff: [],
    repairTickets: [],
    messages: [],
    ...overrides,
  };
}

function tenancy(overrides: Partial<Tenancy> = {}): Tenancy {
  return {
    id: 'tn1',
    tenantId: 't1',
    unitId: 'u1',
    rent: 15000,
    deposit: 20000,
    moveIn: '2026-10-01',
    moveInRent: null,
    moveOut: null,
    leaseStart: '2026-10-01',
    leaseEnd: '2027-09-30',
    openingBalance: 0,
    openingBalanceMonth: null,
    openingReading: null,
    moveInGarbage: null,
    renewal: null,
    moveOutNote: null,
    depositRefund: null,
    ...overrides,
  };
}

let receipt = 0;
function payment(date: string, amount: number, tenancyId = 'tn1'): Payment {
  receipt++;
  return { receiptNumber: `R${receipt}`, tenancyId, amount, date, time: '10:00', method: 'M-Pesa', reference: `REF${receipt}` };
}

function bill(overrides: Partial<MonthlyBill>): MonthlyBill {
  return {
    tenancyId: 'tn1',
    month: '2026-11',
    kind: 'monthly',
    dueDate: '2026-11-05',
    graceDate: '2026-11-10',
    lines: [],
    water: null,
    rent: 0,
    garbage: 0,
    deposit: 0,
    depositApplied: 0,
    depositRefund: 0,
    balanceBf: 0,
    newCharges: 0,
    totalDue: 0,
    amountPaid: 0,
    outstanding: 0,
    status: 'Paid',
    datePaid: null,
    payments: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('cycleOf', () => {
  test('cycles switch to the 4th from FIRST_CYCLE_ON_START_DAY', () => {
    assert.equal(FIRST_CYCLE_ON_START_DAY, '2026-12');
  });

  test('before the switch, cycles are calendar months', () => {
    assert.equal(cycleOf('2026-11-30'), '2026-11');
    assert.equal(cycleOf('2026-11-01'), '2026-11');
    assert.equal(cycleOf('2026-11-03'), '2026-11');
  });

  test('the 1st to 3rd of December 2026 still belong to the November cycle', () => {
    assert.equal(cycleOf('2026-12-01'), '2026-11');
    assert.equal(cycleOf('2026-12-03'), '2026-11');
  });

  test('from the 4th, the date is in its own month’s cycle', () => {
    assert.equal(cycleOf('2026-12-04'), '2026-12');
    assert.equal(cycleOf('2026-12-31'), '2026-12');
  });

  test('the 1st to 3rd of a year roll back across the year boundary', () => {
    assert.equal(cycleOf('2027-01-03'), '2026-12');
    assert.equal(cycleOf('2027-01-04'), '2027-01');
  });
});

describe('addMonths', () => {
  test('within a year, across years, and backwards', () => {
    assert.equal(addMonths('2026-11', 1), '2026-12');
    assert.equal(addMonths('2026-12', 1), '2027-01');
    assert.equal(addMonths('2027-01', -1), '2026-12');
    assert.equal(addMonths('2026-03', -15), '2024-12');
    assert.equal(addMonths('2026-06', 0), '2026-06');
    assert.equal(addMonths('2026-01', 24), '2028-01');
  });
});

describe('ordinal', () => {
  test('suffixes including the teens and hundreds', () => {
    const expected: Record<number, string> = {
      1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 11: '11th', 12: '12th', 13: '13th',
      21: '21st', 22: '22nd', 23: '23rd', 101: '101st', 111: '111th',
    };
    for (const [n, label] of Object.entries(expected)) assert.equal(ordinal(Number(n)), label);
  });
});

describe('statusFor', () => {
  test('credit, paid, partial, unpaid', () => {
    assert.equal(statusFor(20000, -500), 'Credit');
    assert.equal(statusFor(15000, 0), 'Paid');
    assert.equal(statusFor(0, 0), 'Paid');
    assert.equal(statusFor(5000, 10000), 'Partial');
    assert.equal(statusFor(0, 15000), 'Unpaid');
  });
});

describe('collectedFor / collectedByPayment', () => {
  test('the deposit is paid first and is not counted as collections', () => {
    const p1 = payment('2026-10-01', 15000);
    const p2 = payment('2026-10-02', 25000);
    const b = bill({ kind: 'move-in', deposit: 20000, rent: 15000, payments: [p1, p2] });
    assert.deepEqual(collectedByPayment(b).map((c) => c.amount), [0, 20000]);
    assert.equal(collectedFor(b), 20000);
  });

  test('payments towards arrears count in full, not capped at this cycle’s charges', () => {
    const p = payment('2026-11-02', 25000);
    const b = bill({ rent: 15000, garbage: 500, balanceBf: 10000, payments: [p] });
    assert.equal(collectedFor(b), 25000);
  });

  test('no payments, nothing collected', () => {
    assert.equal(collectedFor(bill({ deposit: 20000 })), 0);
  });
});

describe('buildLedger', () => {
  test('an imported tenancy’s opening bill carries only the sheet balance, no charges', () => {
    const t = tenancy({ moveIn: '2024-03-01', openingBalance: 12000, openingBalanceMonth: '2026-10', openingReading: 40 });
    const bills = buildLedger(seed({ tenancies: [t] }), t);
    assert.deepEqual(bills.map((b) => [b.month, b.kind]), [['2026-10', 'opening'], ['2026-11', 'monthly']]);
    const [opening, next] = bills;
    assert.deepEqual(opening.lines, []);
    assert.equal(opening.newCharges, 0);
    assert.equal(opening.totalDue, 12000);
    assert.equal(opening.outstanding, 12000);
    assert.equal(next.balanceBf, 12000);
    assert.equal(next.rent, 15000);
    assert.equal(next.garbage, 500);
    assert.equal(next.totalDue, 12000 + 15500);
  });

  test('an onboarded tenancy gets a move-in bill with deposit and rent', () => {
    const t = tenancy({ moveIn: '2026-10-01', moveInRent: 7500 });
    const s = seed({ tenancies: [t], payments: [payment('2026-10-01', 27500)] });
    const [moveIn, next] = buildLedger(s, t);
    assert.equal(moveIn.month, '2026-10');
    assert.equal(moveIn.kind, 'move-in');
    assert.deepEqual(moveIn.lines, [{ kind: 'deposit', amount: 20000 }, { kind: 'rent', amount: 7500 }]);
    assert.equal(moveIn.deposit, 20000);
    assert.equal(moveIn.outstanding, 0);
    assert.equal(moveIn.status, 'Paid');
    assert.equal(collectedFor(moveIn), 7500);
    assert.equal(next.kind, 'monthly');
  });

  test('billing never runs past the asOf cycle, even with a future meter reading', () => {
    const t = tenancy({ moveIn: '2026-10-01', openingReading: 10 });
    const s = seed({ asOf: '2026-11-20', tenancies: [t], meterReadings: { u1: { '2026-11': 14, '2027-02': 60 } } });
    const bills = buildLedger(s, t);
    assert.equal(bills[bills.length - 1].month, '2026-11');
    assert.deepEqual(bills.map((b) => b.month), ['2026-10', '2026-11']);
    assert.equal(bills[1].water?.units, 4);
  });

  test('billing never runs past the asOf cycle, even with a future-dated payment', () => {
    const t = tenancy({ moveIn: '2026-10-01' });
    const s = seed({ asOf: '2026-11-20', tenancies: [t], payments: [payment('2027-03-01', 5000)] });
    assert.equal(buildLedger(s, t).at(-1)?.month, '2026-11');
  });

  test('payments after a former tenant’s final bill count on that final bill', () => {
    const t = tenancy({ moveIn: '2026-09-01', moveOut: '2026-10-15' });
    const late = payment('2026-12-20', 3000);
    const s = seed({ asOf: '2027-01-20', tenancies: [t], payments: [late] });
    const bills = buildLedger(s, t);
    const final = bills.at(-1)!;
    assert.equal(final.month, '2026-11');
    assert.equal(final.kind, 'final');
    assert.ok(final.payments.some((p) => p.receiptNumber === late.receiptNumber));
    assert.equal(final.amountPaid, 3000);
  });

  test('the final refund includes payments made in the final cycle', () => {
    const t = tenancy({ moveIn: '2026-09-01', moveOut: '2026-10-15' });
    const s = seed({
      asOf: '2026-11-20',
      tenancies: [t],
      payments: [payment('2026-09-02', 35000), payment('2026-10-03', 15500), payment('2026-11-05', 1000)],
    });
    const bills = buildLedger(s, t);
    assert.deepEqual(bills.map((b) => b.kind), ['move-in', 'monthly', 'final']);
    const final = bills[2];
    assert.equal(final.balanceBf, 0);
    assert.equal(final.depositApplied, -20000);
    // Deposit 20,000 plus the 1,000 paid in the final cycle comes back.
    assert.equal(final.depositRefund, 21000);
    assert.equal(final.outstanding, 0);
    assert.equal(final.status, 'Paid');
  });
});
