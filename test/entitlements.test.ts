import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEntitlements,
  hasFeature,
  normalizeEntitlements,
  staffSeatsMessage,
  unitOverage,
} from '../src/lib/entitlements.ts';

const NOW = new Date('2026-11-26T09:00:00+03:00');

test('a missing or empty subscription is an active Starter with Starter limits', () => {
  for (const sub of [null, undefined, {}, 'nonsense', []]) {
    const e = computeEntitlements(sub, NOW);
    assert.equal(e.plan, 'starter');
    assert.equal(e.planName, 'Starter');
    assert.equal(e.status, 'active');
    assert.equal(e.readOnly, false);
    assert.equal(e.unitLimit, 30);
    assert.equal(e.staffLimit, 2);
    assert.equal(e.extraUnitRateKes, 50);
    assert.equal(e.trialEndsAt, null);
    assert.equal(e.billingExempt, false);
    assert.equal(hasFeature(e, 'property_payment_details'), false);
  }
});

test('plan defaults apply per plan; property payment details are off only on Starter', () => {
  const expected = {
    growth: [150, 5, 40],
    enterprise: [450, 20, 30],
    custom: [1200, 50, 20],
  } as const;
  for (const [plan, [units, staff, rate]] of Object.entries(expected)) {
    const e = computeEntitlements({ plan, status: 'active' }, NOW);
    assert.deepEqual([e.unitLimit, e.staffLimit, e.extraUnitRateKes], [units, staff, rate], plan);
    assert.equal(hasFeature(e, 'property_payment_details'), true, plan);
  }
});

test('negotiated subscription values override the plan', () => {
  const e = computeEntitlements({ plan: 'growth', unitLimit: 200, staffLimit: '8', extraUnitRateKes: 0 }, NOW);
  assert.equal(e.unitLimit, 200);
  assert.equal(e.staffLimit, 8);
  assert.equal(e.extraUnitRateKes, 0);
});

test('malformed limits fall back to the plan instead of zero', () => {
  const e = computeEntitlements({ plan: 'growth', unitLimit: 'lots', staffLimit: -1, extraUnitRateKes: null }, NOW);
  assert.equal(e.unitLimit, 150);
  assert.equal(e.staffLimit, 5);
  assert.equal(e.extraUnitRateKes, 40);
});

test('an expired trial is past due; a running trial stays a trial', () => {
  const expired = computeEntitlements({ plan: 'starter', status: 'trial', trialEndsAt: '2026-11-01T00:00:00Z' }, NOW);
  assert.equal(expired.status, 'past_due');
  assert.equal(expired.readOnly, false);
  const running = computeEntitlements({ plan: 'starter', status: 'trial', trialEndsAt: '2026-12-31T00:00:00Z' }, NOW);
  assert.equal(running.status, 'trial');
  assert.equal(running.trialEndsAt, '2026-12-31T00:00:00Z');
  // No end date, or an empty one: still a trial.
  assert.equal(computeEntitlements({ status: 'trial', trialEndsAt: '' }, NOW).status, 'trial');
  assert.equal(computeEntitlements({ status: 'trial' }, NOW).status, 'trial');
});

test('billing exempt shows as active, but a suspension still shows as suspended', () => {
  const exemptTrial = computeEntitlements({ status: 'trial', trialEndsAt: '2026-01-01', billingExempt: true }, NOW);
  assert.equal(exemptTrial.status, 'active');
  assert.equal(exemptTrial.billingExempt, true);
  const exemptPastDue = computeEntitlements({ status: 'past_due', billingExempt: 'true' }, NOW);
  assert.equal(exemptPastDue.status, 'active');
  const exemptSuspended = computeEntitlements({ status: 'suspended', billingExempt: true }, NOW);
  assert.equal(exemptSuspended.status, 'suspended');
  assert.equal(exemptSuspended.readOnly, true);
});

test('suspended and cancelled are read-only; other statuses are not', () => {
  assert.equal(computeEntitlements({ status: 'suspended' }, NOW).readOnly, true);
  assert.equal(computeEntitlements({ status: 'cancelled' }, NOW).readOnly, true);
  for (const status of ['trial', 'active', 'past_due']) {
    assert.equal(computeEntitlements({ status }, NOW).readOnly, false, status);
  }
});

test('feature overrides win over the plan', () => {
  const on = computeEntitlements({ plan: 'starter', featureOverrides: { property_payment_details: true } }, NOW);
  assert.equal(hasFeature(on, 'property_payment_details'), true);
  const off = computeEntitlements({ plan: 'growth', featureOverrides: { property_payment_details: 'false' } }, NOW);
  assert.equal(hasFeature(off, 'property_payment_details'), false);
  // A non-boolean override is ignored.
  const junk = computeEntitlements({ plan: 'starter', featureOverrides: { property_payment_details: 1 } }, NOW);
  assert.equal(hasFeature(junk, 'property_payment_details'), false);
});

test('an unknown plan keeps its id and uses the SQL fallbacks', () => {
  const e = computeEntitlements({ plan: 'pro' }, NOW);
  assert.equal(e.plan, 'pro');
  assert.equal(e.planName, 'Pro');
  assert.deepEqual([e.unitLimit, e.staffLimit, e.extraUnitRateKes], [30, 2, 0]);
});

test('normalizeEntitlements reads the RPC result and tolerates missing fields', () => {
  const full = normalizeEntitlements({
    plan: 'growth', planName: 'Growth', status: 'past_due', readOnly: false,
    unitLimit: 150, staffLimit: 5, extraUnitRateKes: 40, trialEndsAt: null, billingExempt: false,
    features: { property_payment_details: true },
  });
  assert.equal(full.status, 'past_due');
  assert.equal(hasFeature(full, 'property_payment_details'), true);

  const sparse = normalizeEntitlements({ plan: 'starter', status: 'suspended' });
  assert.equal(sparse.readOnly, true);
  assert.equal(sparse.staffLimit, 2);
  assert.equal(hasFeature(sparse, 'property_payment_details'), false);

  // A plan row without the switch keeps the plan's code default.
  const growthNoKey = normalizeEntitlements({ plan: 'growth', features: {} });
  assert.equal(hasFeature(growthNoKey, 'property_payment_details'), true);
});

test('unit overage is billed per extra unit unless billing exempt', () => {
  const e = computeEntitlements({ plan: 'starter' }, NOW);
  assert.deepEqual(unitOverage(e, 25), { extraUnits: 0, monthlyKes: 0 });
  assert.deepEqual(unitOverage(e, 30), { extraUnits: 0, monthlyKes: 0 });
  assert.deepEqual(unitOverage(e, 34), { extraUnits: 4, monthlyKes: 200 });
  const exempt = computeEntitlements({ plan: 'starter', billingExempt: true }, NOW);
  assert.deepEqual(unitOverage(exempt, 34), { extraUnits: 4, monthlyKes: 0 });
});

test('the seat message matches the database trigger', () => {
  assert.equal(staffSeatsMessage(2), 'Your plan includes 2 staff seats. Ask Makazi support to change your plan to add another.');
  assert.equal(staffSeatsMessage(1), 'Your plan includes 1 staff seat. Ask Makazi support to change your plan to add another.');
});

test('a suspended company stays suspended even when billing exempt', () => {
  const e = computeEntitlements({ plan: 'enterprise', status: 'suspended', billingExempt: true }, new Date('2026-11-26'));
  assert.equal(e.status, 'suspended');
  assert.equal(e.readOnly, true);
});
