// What a company may do on its Makazi plan right now.
//
// The source of truth is the database function public.company_entitlements
// (migration 20261126130000_plan_entitlements.sql), which the super-admin
// reads too. Until that migration is applied the RPC is missing, so this
// falls back to companies.subscription with the same rules as the SQL.
//
// Never cached across requests: a suspension must take effect on the next
// request. Within one request the result is shared through a scope object
// (Astro.locals), so the middleware, the layout and the page ask once.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlanId, SubscriptionStatus } from './billing';

export type FeatureKey = 'property_payment_details';

export interface Entitlements {
  plan: string;
  planName: string;
  /** Effective status: an expired trial is past_due; billing exempt is active. */
  status: SubscriptionStatus;
  /** Suspended or cancelled: every landlord write is refused. */
  readOnly: boolean;
  unitLimit: number;
  staffLimit: number;
  extraUnitRateKes: number;
  trialEndsAt: string | null;
  billingExempt: boolean;
  features: Partial<Record<FeatureKey, boolean>> & Record<string, boolean>;
}

interface PlanDefaults {
  name: string;
  unitLimit: number;
  staffLimit: number;
  extraUnitRateKes: number;
  features: Record<FeatureKey, boolean>;
}

/**
 * The seed rows of public.platform_plans. Used only when the RPC is not
 * available; plans are changed in the table, not here.
 */
export const PLAN_DEFAULTS: Record<PlanId, PlanDefaults> = {
  starter: { name: 'Starter', unitLimit: 30, staffLimit: 2, extraUnitRateKes: 50, features: { property_payment_details: false } },
  growth: { name: 'Growth', unitLimit: 150, staffLimit: 5, extraUnitRateKes: 40, features: { property_payment_details: true } },
  enterprise: { name: 'Enterprise', unitLimit: 450, staffLimit: 20, extraUnitRateKes: 30, features: { property_payment_details: true } },
  custom: { name: 'Custom', unitLimit: 1200, staffLimit: 50, extraUnitRateKes: 20, features: { property_payment_details: true } },
};

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

export const READ_ONLY_MESSAGE = 'This Makazi account is suspended. Contact Makazi support to restore access.';
export const PROPERTY_PAYMENTS_LOCKED_MESSAGE = 'Payment details per property are on the Growth plan and above.';
export const CHANGE_PLAN_HINT = 'Ask Makazi support to change your plan.';

const STATUSES = new Set<string>(Object.keys(STATUS_LABELS));
const isPlanId = (v: string): v is PlanId => Object.prototype.hasOwnProperty.call(PLAN_DEFAULTS, v);

type Raw = Record<string, unknown>;
const asObject = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
/** A whole number of 0 or more, or null when missing or not a number. */
const asCount = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};
/** Postgres casts 'true'/'false' text to boolean; mirror that. */
const asBool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
};
const asFeatures = (v: unknown): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(asObject(v))) {
    const b = asBool(value);
    if (b !== null) out[key] = b;
  }
  return out;
};
const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The SQL rules of app.company_entitlements, applied to a stored
 * companies.subscription value (any shape, including null).
 */
export function computeEntitlements(subscription: unknown, now: Date = new Date()): Entitlements {
  const sub = asObject(subscription);
  const plan = asText(sub.plan) ?? 'starter';
  const defaults = isPlanId(plan) ? PLAN_DEFAULTS[plan] : null;
  const storedStatus = asText(sub.status) ?? 'active';
  const billingExempt = asBool(sub.billingExempt) ?? false;
  const trialEndsAt = asText(sub.trialEndsAt);
  const trialEnd = trialEndsAt ? Date.parse(trialEndsAt) : NaN;

  let status: string = storedStatus;
  if (storedStatus === 'suspended' || storedStatus === 'cancelled') status = storedStatus;
  else if (billingExempt) status = 'active';
  else if (storedStatus === 'trial' && Number.isFinite(trialEnd) && trialEnd < now.getTime()) status = 'past_due';

  return {
    plan,
    planName: defaults?.name ?? titleCase(plan),
    status: (STATUSES.has(status) ? status : 'active') as SubscriptionStatus,
    // From the stored status, as in SQL: billing exempt does not lift a suspension.
    readOnly: storedStatus === 'suspended' || storedStatus === 'cancelled',
    unitLimit: asCount(sub.unitLimit) ?? defaults?.unitLimit ?? 30,
    staffLimit: asCount(sub.staffLimit) ?? defaults?.staffLimit ?? 2,
    extraUnitRateKes: asCount(sub.extraUnitRateKes) ?? defaults?.extraUnitRateKes ?? 0,
    trialEndsAt,
    billingExempt,
    features: { ...(defaults?.features ?? {}), ...asFeatures(sub.featureOverrides) },
  };
}

/**
 * The RPC's JSON, made safe to read: missing or malformed fields take the
 * same defaults as the fallback.
 */
export function normalizeEntitlements(raw: unknown): Entitlements {
  const r = asObject(raw);
  const plan = asText(r.plan) ?? 'starter';
  const defaults = isPlanId(plan) ? PLAN_DEFAULTS[plan] : null;
  const status = asText(r.status) ?? 'active';
  return {
    plan,
    planName: asText(r.planName) ?? defaults?.name ?? titleCase(plan),
    status: (STATUSES.has(status) ? status : 'active') as SubscriptionStatus,
    readOnly: asBool(r.readOnly) ?? (status === 'suspended' || status === 'cancelled'),
    unitLimit: asCount(r.unitLimit) ?? defaults?.unitLimit ?? 30,
    staffLimit: asCount(r.staffLimit) ?? defaults?.staffLimit ?? 2,
    extraUnitRateKes: asCount(r.extraUnitRateKes) ?? defaults?.extraUnitRateKes ?? 0,
    trialEndsAt: asText(r.trialEndsAt),
    billingExempt: asBool(r.billingExempt) ?? false,
    features: asFeatures(r.features),
  };
}

/**
 * Whether a feature is on. A switch the plan row does not mention takes the
 * code default for that plan (off only on Starter), so a plan saved without
 * the key keeps the behaviour it had.
 */
export function hasFeature(e: Entitlements, key: FeatureKey): boolean {
  const value = e.features[key];
  if (typeof value === 'boolean') return value;
  return isPlanId(e.plan) ? PLAN_DEFAULTS[e.plan].features[key] : true;
}

/** Units over the plan and what they add a month. Nothing is owed when billing exempt. */
export function unitOverage(e: Entitlements, unitsUsed: number): { extraUnits: number; monthlyKes: number } {
  const extraUnits = Math.max(0, unitsUsed - e.unitLimit);
  return { extraUnits, monthlyKes: e.billingExempt ? 0 : extraUnits * e.extraUnitRateKes };
}

export function staffSeatsMessage(staffLimit: number): string {
  return `Your plan includes ${staffLimit} staff seat${staffLimit === 1 ? '' : 's'}. Ask Makazi support to change your plan to add another.`;
}

const memo = new WeakMap<object, Map<string, Promise<Entitlements>>>();
let warnedFallback = false;

async function load(supabase: SupabaseClient, companyId: string): Promise<Entitlements> {
  const { data, error } = await supabase.rpc('company_entitlements', { p_company_id: companyId });
  if (!error && data && typeof data === 'object') return normalizeEntitlements(data);
  if (error && !warnedFallback) {
    warnedFallback = true;
    console.warn('[entitlements] company_entitlements RPC unavailable, using companies.subscription:', error.code, error.message);
  }

  const { data: row, error: rowErr } = await supabase
    .from('companies')
    .select('subscription')
    .eq('id', companyId)
    .maybeSingle();
  if (rowErr) throw rowErr;
  if (!row) throw new Error('Company not found');
  return computeEntitlements(row.subscription);
}

/**
 * The company's entitlements for this request. Pass Astro.locals as
 * `scope` so every caller in the same request shares one lookup. Throws
 * when neither the RPC nor the companies row can be read.
 */
export function getEntitlements(supabase: SupabaseClient, companyId: string, scope?: object): Promise<Entitlements> {
  if (!scope) return load(supabase, companyId);
  let byCompany = memo.get(scope);
  if (!byCompany) {
    byCompany = new Map();
    memo.set(scope, byCompany);
  }
  let pending = byCompany.get(companyId);
  if (!pending) {
    pending = load(supabase, companyId);
    // A failed lookup is not remembered: the next caller tries again.
    pending.catch(() => byCompany!.delete(companyId));
    byCompany.set(companyId, pending);
  }
  return pending;
}
