// Regenerates the tenant app's billing parity fixture: runs this engine over
// PropMgtApp/test/fixtures/billing-fixture.json and writes the bills the Dart
// engine must match (PropMgtApp/test/unit/billing_parity_test.dart).
// Run after changing a billing rule: node scripts/billing-parity.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { buildLedger, type Seed } from '../src/lib/billing.ts';

const fixtures = new URL('../../PropMgtApp/test/fixtures/', import.meta.url);
const seed = JSON.parse(readFileSync(new URL('billing-fixture.json', fixtures), 'utf8')) as Seed;

const expected = Object.fromEntries(
  seed.tenancies.map((tenancy) => [
    tenancy.id,
    buildLedger(seed, tenancy).map((bill) => ({
      month: bill.month,
      kind: bill.kind,
      rent: bill.rent,
      waterUnits: bill.water?.units ?? null,
      water: bill.water?.amount ?? 0,
      garbage: bill.garbage,
      deposit: bill.deposit,
      depositApplied: bill.depositApplied,
      depositRefund: bill.depositRefund,
      balanceBf: bill.balanceBf,
      newCharges: bill.newCharges,
      totalDue: bill.totalDue,
      amountPaid: bill.amountPaid,
      outstanding: bill.outstanding,
      status: bill.status,
      datePaid: bill.datePaid,
    })),
  ]),
);

writeFileSync(new URL('billing-fixture-expected.json', fixtures), `${JSON.stringify(expected, null, 2)}\n`);
console.log(`Wrote bills for ${seed.tenancies.length} tenancies.`);
