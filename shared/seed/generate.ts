// Generates the shared demo portfolio for the tenant app and the admin.
//
//   node shared/seed/generate.ts
//
// Two demo landlords on the Makazi platform: HarborRidge Limited (Nairobi)
// and Savanna Homes Ltd (Nakuru), each with their own settings, numbering
// and plan.
//
// Writes:
//   shared/billing-seed.json        facts for both companies
//   shared/billing-expected.json    engine output, used as the Dart parity fixture
//   lib/core/billing/seed/tenant_seed.g.dart   one slice per demo tenant account
//
// Payments are derived from per-tenancy payment plans so the amounts always
// match the bills the engine produces (water varies month to month).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addMonths,
  buildLedger,
  monthOf,
  monthsBetween,
  type Company,
  type Message,
  type Month,
  type Payment,
  type PaymentMethod,
  type RepairTicket,
  type Seed,
  type Tenancy,
} from '../../PropAdmin/src/lib/billing.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Deterministic PRNG so regenerating gives identical output.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// One random stream per company, so adding a company never changes
// another company's numbers.
const streams = new Map<string, () => number>([
  ['harborridge', mulberry32(20261006)],
  ['savanna', mulberry32(20261007)],
  ['acacia', mulberry32(20261008)],
]);
let rand = streams.get('harborridge')!;
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const pick = (chars: string) => chars[Math.floor(rand() * chars.length)];
function mpesaRef() {
  let s = 'S' + pick(LETTERS);
  for (let i = 0; i < 8; i++) s += pick(ALNUM);
  return s;
}
function bankRef(date: string) {
  return `FT${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}${between(1000, 9999)}`;
}

const COMPANY_ID = 'harborridge';
const SV = 'savanna';
const AS_OF = '2026-10-06';
const ASOF_MONTH = monthOf(AS_OF);

const companies: Company[] = [
  {
    id: COMPANY_ID,
    slug: 'harborridge',
    name: 'HarborRidge Limited',
    kraPin: 'P051234567X',
    mpesaPaybill: '522533',
    bankName: 'NCBA Bank, Westlands',
    bankAccount: '1004558231',
    settings: { ledgerStartMonth: '2026-05', dueDay: 5, graceDay: 20, depositSchedule: { '1': 25000, '2': 30000 }, recordRetentionMonths: 6 },
    sequences: { receipt: 0, repairTicket: 0 },
    subscription: { plan: 'growth', status: 'active', unitLimit: 100, staffLimit: 10, trialEndsAt: null },
  },
  {
    id: SV,
    slug: 'savanna',
    name: 'Savanna Homes Ltd',
    kraPin: 'P052765431Q',
    mpesaPaybill: '400200',
    bankName: 'Equity Bank, Nakuru',
    bankAccount: '0170299934455',
    // Deliberately different rules, so per-company settings are exercised.
    settings: { ledgerStartMonth: '2026-07', dueDay: 1, graceDay: 10, depositSchedule: { '1': 15000, '2': 20000 }, recordRetentionMonths: 12 },
    sequences: { receipt: 0, repairTicket: 0 },
    subscription: { plan: 'starter', status: 'trial', unitLimit: 20, staffLimit: 3, trialEndsAt: '2026-10-31' },
  },
  {
    // Just signed up: no properties, tenants or money yet. Exercises every
    // empty state in the admin.
    id: 'acacia',
    slug: 'acacia',
    name: 'Acacia Rentals',
    kraPin: 'P053318822K',
    mpesaPaybill: '247900',
    bankName: 'KCB Bank, Thika',
    bankAccount: '1290033451',
    settings: { ledgerStartMonth: '2026-10', dueDay: 5, graceDay: 15, depositSchedule: { '1': 10000, '2': 15000 }, recordRetentionMonths: 6 },
    sequences: { receipt: 0, repairTicket: 0 },
    subscription: { plan: 'starter', status: 'trial', unitLimit: 20, staffLimit: 3, trialEndsAt: '2026-11-06' },
  },
];

const seed: Seed = {
  asOf: AS_OF,
  companies,
  properties: [
    { id: 'kilimani-heights', companyId: COMPANY_ID, managerId: 's-njoki', name: 'Kilimani Heights', type: 'apartments', address: 'Argwings Kodhek Rd, Kilimani', accountPrefix: 'KH', waterRate: 150, garbageFee: 250 },
    { id: 'riverside-court', companyId: COMPANY_ID, managerId: 's-njoki', name: 'Riverside Court', type: 'apartments', address: 'Riverside Dr, Westlands', accountPrefix: 'RC', waterRate: 150, garbageFee: 250 },
    { id: 'mvuli-gardens', companyId: COMPANY_ID, managerId: 's-njoki', name: 'Mvuli Gardens', type: 'houses', address: 'Mvuli Rd, Westlands', accountPrefix: 'MG', waterRate: 150, garbageFee: 250 },
    // Water went up in September (KES 130 -> 150 per unit).
    { id: 'ngong-road', companyId: COMPANY_ID, managerId: 's-njoki', name: 'Ngong Road Residences', type: 'apartments', address: 'Ngong Rd, Adams Arcade', accountPrefix: 'NR', waterRate: 150, garbageFee: 250, rateHistory: [{ from: '2026-05', waterRate: 130, garbageFee: 250 }, { from: '2026-09', waterRate: 150, garbageFee: 250 }] },
    { id: 'milimani-court', companyId: SV, managerId: 's-wanjiru', name: 'Milimani Court', type: 'apartments', address: 'Milimani, Nakuru', accountPrefix: 'MC', waterRate: 120, garbageFee: 200 },
    { id: 'lanet-cottages', companyId: SV, managerId: 's-wanjiru', name: 'Lanet Cottages', type: 'houses', address: 'Lanet, Nakuru', accountPrefix: 'LC', waterRate: 120, garbageFee: 300 },
  ],
  units: [
    { id: 'kh-a03', propertyId: 'kilimani-heights', label: 'A03', bedrooms: 1 },
    { id: 'kh-a12', propertyId: 'kilimani-heights', label: 'A12', bedrooms: 1 },
    { id: 'kh-b04', propertyId: 'kilimani-heights', label: 'B04', bedrooms: 2 },
    { id: 'kh-c09', propertyId: 'kilimani-heights', label: 'C09', bedrooms: 2 },
    { id: 'kh-d02', propertyId: 'kilimani-heights', label: 'D02', bedrooms: 1 },
    { id: 'rc-1c', propertyId: 'riverside-court', label: '1C', bedrooms: 1 },
    { id: 'rc-2a', propertyId: 'riverside-court', label: '2A', bedrooms: 2 },
    { id: 'rc-3b', propertyId: 'riverside-court', label: '3B', bedrooms: 2 },
    { id: 'rc-5a', propertyId: 'riverside-court', label: '5A', bedrooms: 2 },
    { id: 'mg-2', propertyId: 'mvuli-gardens', label: 'MG-2', bedrooms: 2 },
    { id: 'mg-4', propertyId: 'mvuli-gardens', label: 'MG-4', bedrooms: 2 },
    { id: 'mg-6', propertyId: 'mvuli-gardens', label: 'MG-6', bedrooms: 2 },
    { id: 'nr-114', propertyId: 'ngong-road', label: '114', bedrooms: 1 },
    { id: 'nr-207', propertyId: 'ngong-road', label: '207', bedrooms: 1 },
    { id: 'nr-312', propertyId: 'ngong-road', label: '312', bedrooms: 1 },
    { id: 'nr-405', propertyId: 'ngong-road', label: '405', bedrooms: 1 },
    { id: 'mc-1', propertyId: 'milimani-court', label: '1', bedrooms: 1 },
    { id: 'mc-2', propertyId: 'milimani-court', label: '2', bedrooms: 1 },
    { id: 'mc-3', propertyId: 'milimani-court', label: '3', bedrooms: 2 },
    { id: 'mc-4', propertyId: 'milimani-court', label: '4', bedrooms: 2 },
    { id: 'lc-a', propertyId: 'lanet-cottages', label: 'A', bedrooms: 2 },
    { id: 'lc-b', propertyId: 'lanet-cottages', label: 'B', bedrooms: 2 },
  ],
  tenants: [
    { id: 't-wanjiku', companyId: COMPANY_ID, name: 'Wanjiku Kamau', phone: '0712 448 203', email: 'wanjiku.kamau@example.com' },
    { id: 't-brian', companyId: COMPANY_ID, name: 'Brian Otieno', phone: '0722 913 054', email: 'brian.otieno@example.com' },
    { id: 't-samuel', companyId: COMPANY_ID, name: 'Samuel Mutua', phone: '0727 640 205', email: 'samuel.mutua@example.com' },
    { id: 't-peter', companyId: COMPANY_ID, name: 'Peter Odhiambo', phone: '0798 266 015', email: 'peter.odhiambo@example.com' },
    { id: 't-esther', companyId: COMPANY_ID, name: 'Esther Mutheu', phone: '0711 302 774', email: 'esther.mutheu@example.com' },
    { id: 't-ian', companyId: COMPANY_ID, name: 'Ian Ndegwa', phone: '0701 554 210', email: 'ian.ndegwa@example.com' },
    { id: 't-joseph', companyId: COMPANY_ID, name: 'Joseph Kariuki', phone: '0720 671 093', email: 'joseph.kariuki@example.com' },
    { id: 't-amina', companyId: COMPANY_ID, name: 'Amina Hassan', phone: '0757 118 640', email: 'amina.hassan@example.com' },
    { id: 't-david', companyId: COMPANY_ID, name: 'David Mwangi', phone: '0733 605 118', email: 'david.mwangi@example.com' },
    { id: 't-grace', companyId: COMPANY_ID, name: 'Grace Njeri', phone: '0710 225 981', email: 'grace.njeri@example.com' },
    { id: 't-mercy', companyId: COMPANY_ID, name: 'Mercy Chebet', phone: '0729 840 377', email: 'mercy.chebet@example.com' },
    { id: 't-kevin', companyId: COMPANY_ID, name: 'Kevin Kiprop', phone: '0790 118 462', email: 'kevin.kiprop@example.com' },
    { id: 't-faith', companyId: COMPANY_ID, name: 'Faith Achieng', phone: '0708 352 917', email: 'faith.achieng@example.com' },
    { id: 't-lucy', companyId: COMPANY_ID, name: 'Lucy Wambui', phone: '0745 902 336', email: 'lucy.wambui@example.com' },
    { id: 't-joy', companyId: COMPANY_ID, name: 'Joy Wairimu', phone: '0768 430 552', email: 'joy.wairimu@example.com' },
    { id: 't-barasa', companyId: SV, name: 'Otieno Barasa', phone: '0714 220 871', email: 'otieno.barasa@example.com' },
    { id: 't-naliaka', companyId: SV, name: 'Naliaka Wekesa', phone: '0723 555 019', email: 'naliaka.wekesa@example.com' },
    { id: 't-kipchumba', companyId: SV, name: 'Kipchumba Rotich', phone: '0790 664 302', email: 'kipchumba.rotich@example.com' },
    { id: 't-akinyi', companyId: SV, name: 'Akinyi Odera', phone: '0741 908 116', email: 'akinyi.odera@example.com' },
    { id: 't-muthoni', companyId: SV, name: 'Muthoni Gitau', phone: '0702 373 845', email: 'muthoni.gitau@example.com' },
  ],
  tenancies: [],
  meterReadings: {},
  payments: [],
  staff: [
    { id: 's-owner', companyId: COMPANY_ID, name: 'HarborRidge Admin', role: 'owner', phone: null, propertyIds: [] },
    { id: 's-njoki', companyId: COMPANY_ID, name: 'Njoki Kariuki', role: 'manager', phone: '0711 000 222', propertyIds: [] },
    { id: 's-otieno', companyId: COMPANY_ID, name: 'Otieno Ouma', role: 'caretaker', phone: '0722 000 333', propertyIds: ['kilimani-heights', 'riverside-court'] },
    { id: 's-achieng', companyId: COMPANY_ID, name: 'Achieng Atieno', role: 'caretaker', phone: '0733 000 444', propertyIds: ['mvuli-gardens', 'ngong-road'] },
    { id: 's-sv-owner', companyId: SV, name: 'Savanna Admin', role: 'owner', phone: null, propertyIds: [] },
    { id: 's-wanjiru', companyId: SV, name: 'Wanjiru Maina', role: 'manager', phone: '0711 600 101', propertyIds: [] },
    { id: 's-ndirangu', companyId: SV, name: 'Kamau Ndirangu', role: 'caretaker', phone: '0722 600 202', propertyIds: [] },
    { id: 's-acacia-owner', companyId: 'acacia', name: 'Acacia Admin', role: 'owner', phone: null, propertyIds: [] },
  ],
  repairTickets: [],
  messages: [],
};

type Plan =
  | { type: 'full'; day: number; method?: PaymentMethod }
  | { type: 'amount'; amount: number; day: number; method?: PaymentMethod }
  | { type: 'rentOnly'; day: number; method?: PaymentMethod }
  | { type: 'split'; days: [number, number]; method?: PaymentMethod }
  | { type: 'none' };

interface Scenario {
  company?: string;
  tenancy: Omit<Tenancy, 'renewal' | 'moveOutNote' | 'depositRefund' | 'openingBalance' | 'openingReading' | 'moveOut'> &
    Partial<Pick<Tenancy, 'renewal' | 'moveOutNote' | 'depositRefund' | 'openingBalance' | 'moveOut'>>;
  method: PaymentMethod;
  plan: Plan;
  overrides?: Record<Month, Plan>;
}

const scenarios: Scenario[] = [
  // Kilimani Heights (apartments)
  { tenancy: { id: 'L-2207', tenantId: 't-wanjiku', unitId: 'kh-a12', rent: 25000, deposit: 25000, moveIn: '2026-04-01', leaseStart: '2026-04-01', leaseEnd: '2027-03-31' }, method: 'M-Pesa', plan: { type: 'full', day: 1 } },
  { tenancy: { id: 'L-2192', tenantId: 't-brian', unitId: 'kh-b04', rent: 30000, deposit: 30000, moveIn: '2026-01-01', leaseStart: '2026-01-01', leaseEnd: '2026-12-31' }, method: 'M-Pesa', plan: { type: 'full', day: 4 }, overrides: { '2026-09': { type: 'none' }, '2026-10': { type: 'none' } } },
  { tenancy: { id: 'L-2121', tenantId: 't-samuel', unitId: 'kh-c09', rent: 30000, deposit: 30000, moveIn: '2025-02-01', leaseStart: '2026-02-01', leaseEnd: '2027-01-31' }, method: 'M-Pesa', plan: { type: 'full', day: 2 } },
  { tenancy: { id: 'L-2138', tenantId: 't-peter', unitId: 'kh-a03', rent: 25000, deposit: 25000, moveIn: '2025-06-01', leaseStart: '2025-06-01', leaseEnd: '2027-05-31' }, method: 'M-Pesa', plan: { type: 'full', day: 3 }, overrides: { '2026-10': { type: 'none' } } },
  {
    tenancy: {
      id: 'L-2044', tenantId: 't-esther', unitId: 'kh-d02', rent: 24000, deposit: 25000, moveIn: '2024-08-01', moveOut: '2026-07-31', leaseStart: '2025-08-01', leaseEnd: '2026-07-31', openingBalance: 4000,
      moveOutNote: 'Left owing a balance after the deposit was applied. Promised to clear by M-Pesa.',
    },
    method: 'M-Pesa', plan: { type: 'rentOnly', day: 6 }, overrides: { '2026-06': { type: 'none' }, '2026-07': { type: 'amount', amount: 33000, day: 12 }, '2026-08': { type: 'none' } },
  },
  // Riverside Court (apartments)
  { tenancy: { id: 'L-2150', tenantId: 't-ian', unitId: 'rc-1c', rent: 24000, deposit: 25000, moveIn: '2025-09-01', leaseStart: '2025-09-01', leaseEnd: '2027-08-31' }, method: 'M-Pesa', plan: { type: 'full', day: 2 } },
  { tenancy: { id: 'L-2179', tenantId: 't-amina', unitId: 'rc-3b', rent: 30000, deposit: 30000, moveIn: '2025-12-01', leaseStart: '2025-12-01', leaseEnd: '2026-11-30' }, method: 'M-Pesa', plan: { type: 'full', day: 1 } },
  {
    tenancy: {
      id: 'L-2160', tenantId: 't-david', unitId: 'rc-5a', rent: 30000, deposit: 30000, moveIn: '2025-11-01', leaseStart: '2025-11-01', leaseEnd: '2026-10-31',
      renewal: { leaseId: 'L-2231', rent: 31500, start: '2026-11-01', end: '2027-10-31', status: 'Awaiting signature' },
    },
    method: 'M-Pesa', plan: { type: 'full', day: 2 },
    overrides: { '2026-08': { type: 'full', day: 4, method: 'Bank' }, '2026-09': { type: 'rentOnly', day: 3 }, '2026-10': { type: 'amount', amount: 15000, day: 2 } },
  },
  {
    tenancy: {
      id: 'L-2071', tenantId: 't-joseph', unitId: 'rc-2a', rent: 30000, deposit: 30000, moveIn: '2025-03-01', moveOut: '2026-08-31', leaseStart: '2025-03-01', leaseEnd: '2026-08-31',
      moveOutNote: 'Unit handed back in good condition. Deposit balance refunded by M-Pesa.',
      depositRefund: { date: '2026-09-08', method: 'M-Pesa', reference: 'SH7Q2KD81M' },
    },
    method: 'M-Pesa', plan: { type: 'full', day: 1 }, overrides: { '2026-09': { type: 'none' } },
  },
  // Mvuli Gardens (houses)
  { tenancy: { id: 'L-2154', tenantId: 't-grace', unitId: 'mg-2', rent: 32000, deposit: 30000, moveIn: '2025-07-01', leaseStart: '2025-07-01', leaseEnd: '2027-06-30' }, method: 'Bank', plan: { type: 'full', day: 3 } },
  { tenancy: { id: 'L-2198', tenantId: 't-mercy', unitId: 'mg-6', rent: 32000, deposit: 30000, moveIn: '2026-02-01', leaseStart: '2026-02-01', leaseEnd: '2027-01-31' }, method: 'Bank', plan: { type: 'full', day: 4 }, overrides: { '2026-09': { type: 'amount', amount: 38000, day: 29 } } },
  // Ngong Road Residences (apartments)
  { tenancy: { id: 'L-2185', tenantId: 't-kevin', unitId: 'nr-114', rent: 20000, deposit: 25000, moveIn: '2025-11-01', leaseStart: '2025-11-01', leaseEnd: '2026-10-31' }, method: 'M-Pesa', plan: { type: 'full', day: 5 }, overrides: { '2026-08': { type: 'amount', amount: 10000, day: 9 }, '2026-09': { type: 'none' }, '2026-10': { type: 'none' } } },
  { tenancy: { id: 'L-2166', tenantId: 't-faith', unitId: 'nr-207', rent: 20000, deposit: 25000, moveIn: '2025-10-01', leaseStart: '2025-10-01', leaseEnd: '2026-12-31' }, method: 'M-Pesa', plan: { type: 'split', days: [3, 18] }, overrides: { '2026-10': { type: 'amount', amount: 10000, day: 3 } } },
  { tenancy: { id: 'L-2172', tenantId: 't-lucy', unitId: 'nr-312', rent: 20000, deposit: 25000, moveIn: '2025-11-01', leaseStart: '2025-11-01', leaseEnd: '2026-12-31' }, method: 'M-Pesa', plan: { type: 'full', day: 2 }, overrides: { '2026-10': { type: 'none' } } },
  { tenancy: { id: 'L-2240', tenantId: 't-joy', unitId: 'nr-405', rent: 20000, deposit: 25000, moveIn: '2026-09-16', leaseStart: '2026-09-16', leaseEnd: '2027-09-15' }, method: 'M-Pesa', plan: { type: 'full', day: 2 }, overrides: { '2026-09': { type: 'full', day: 16 } } },

  // Savanna Homes Ltd, Nakuru: due on the 1st, grace to the 10th, on Makazi since July.
  { company: SV, tenancy: { id: 'SV-101', tenantId: 't-barasa', unitId: 'mc-1', rent: 12000, deposit: 15000, moveIn: '2025-05-01', leaseStart: '2026-05-01', leaseEnd: '2027-04-30' }, method: 'M-Pesa', plan: { type: 'full', day: 1 } },
  { company: SV, tenancy: { id: 'SV-102', tenantId: 't-naliaka', unitId: 'mc-3', rent: 18000, deposit: 20000, moveIn: '2026-01-01', leaseStart: '2026-01-01', leaseEnd: '2026-12-31' }, method: 'M-Pesa', plan: { type: 'full', day: 1 }, overrides: { '2026-10': { type: 'amount', amount: 8000, day: 3 } } },
  { company: SV, tenancy: { id: 'SV-103', tenantId: 't-kipchumba', unitId: 'lc-a', rent: 22000, deposit: 20000, moveIn: '2025-09-01', leaseStart: '2025-09-01', leaseEnd: '2026-11-30' }, method: 'Bank', plan: { type: 'full', day: 4 }, overrides: { '2026-09': { type: 'none' }, '2026-10': { type: 'none' } } },
  { company: SV, tenancy: { id: 'SV-104', tenantId: 't-akinyi', unitId: 'mc-2', rent: 12000, deposit: 15000, moveIn: '2026-08-12', leaseStart: '2026-08-12', leaseEnd: '2027-08-11' }, method: 'M-Pesa', plan: { type: 'full', day: 1 }, overrides: { '2026-08': { type: 'full', day: 12 } } },
  {
    company: SV,
    tenancy: {
      id: 'SV-105', tenantId: 't-muthoni', unitId: 'lc-b', rent: 22000, deposit: 20000, moveIn: '2025-03-01', moveOut: '2026-08-31', leaseStart: '2025-03-01', leaseEnd: '2026-08-31',
      moveOutNote: 'Moved to Nairobi for work. Deposit balance refunded.',
      depositRefund: { date: '2026-09-05', method: 'M-Pesa', reference: 'SH9KT2ZQ4D' },
    },
    method: 'M-Pesa', plan: { type: 'full', day: 1 }, overrides: { '2026-09': { type: 'none' } },
  },
];
// Properties without a rate change have had the same rates since joining.
for (const p of seed.properties) {
  if (!p.rateHistory?.length) {
    const start = companies.find((c) => c.id === p.companyId)!.settings.ledgerStartMonth;
    p.rateHistory = [{ from: start, waterRate: p.waterRate, garbageFee: p.garbageFee }];
  }
  const latest = p.rateHistory[p.rateHistory.length - 1];
  if (latest.waterRate !== p.waterRate || latest.garbageFee !== p.garbageFee) {
    throw new Error(`${p.id}: current rates must match the latest rateHistory entry`);
  }
}
const companyOfScenario = (s: Scenario) => s.company ?? COMPANY_ID;
const settingsOf = (companyId: string) => companies.find((c) => c.id === companyId)!.settings;

seed.tenancies = scenarios.map(({ tenancy }) => ({
  openingBalance: 0,
  openingReading: null,
  moveOut: null,
  renewal: null,
  moveOutNote: null,
  depositRefund: null,
  ...tenancy,
}));

// Meter readings on the 1st of each month. Consumption only while occupied.
for (const unit of seed.units) {
  const property = seed.properties.find((p) => p.id === unit.propertyId)!;
  rand = streams.get(property.companyId)!;
  const readingMonths = monthsBetween(addMonths(settingsOf(property.companyId).ledgerStartMonth, -1), ASOF_MONTH);
  const isHouse = property.type === 'houses';
  let value = between(120, 980);
  const readings: Record<Month, number> = {};
  for (const month of readingMonths) {
    readings[month] = value;
    const occupant = seed.tenancies.find((t) => {
      const from = monthOf(t.moveIn);
      const to = t.moveOut ? monthOf(t.moveOut) : '9999-12';
      return t.unitId === unit.id && month >= from && month <= to;
    });
    if (occupant) value += isHouse ? between(16, 30) : between(7, 19);
  }
  seed.meterReadings[unit.id] = readings;
}

// Move-ins inside the ledger window record the meter at move-in. The demo
// readings are taken on the 1st and vacant units use no water, so the
// reading on the 1st of the move-in month is the move-in reading.
for (const scenario of scenarios) {
  const t = seed.tenancies.find((x) => x.id === scenario.tenancy.id)!;
  if (monthOf(t.moveIn) >= settingsOf(companyOfScenario(scenario)).ledgerStartMonth) {
    t.openingReading = seed.meterReadings[t.unitId][monthOf(t.moveIn)];
  }
}

// Payments, month by month, so each plan sees the bill it is paying.
const pad = (n: number) => String(n).padStart(2, '0');
const earliestStart = companies.map((c) => c.settings.ledgerStartMonth).sort()[0];
for (const month of monthsBetween(earliestStart, ASOF_MONTH)) {
  for (const scenario of scenarios) {
    rand = streams.get(companyOfScenario(scenario))!;
    const tenancy = seed.tenancies.find((t) => t.id === scenario.tenancy.id)!;
    const bill = buildLedger(seed, tenancy).find((b) => b.month === month);
    if (!bill) continue;
    const plan = scenario.overrides?.[month] ?? (bill.kind === 'final' ? { type: 'none' as const } : scenario.plan);
    if (plan.type === 'none') continue;

    const method = ('method' in plan && plan.method) || scenario.method;
    const entries: Array<{ amount: number; day: number }> = [];
    if (plan.type === 'full') entries.push({ amount: bill.totalDue, day: plan.day });
    if (plan.type === 'amount') entries.push({ amount: plan.amount, day: plan.day });
    if (plan.type === 'rentOnly') entries.push({ amount: tenancy.rent, day: plan.day });
    if (plan.type === 'split') {
      const first = Math.round(bill.totalDue / 2 / 100) * 100;
      entries.push({ amount: first, day: plan.days[0] }, { amount: bill.totalDue - first, day: plan.days[1] });
    }

    for (const { amount, day } of entries) {
      if (amount <= 0) continue;
      const date = `${month}-${pad(day)}`;
      if (date > AS_OF) continue;
      seed.payments.push({
        receiptNumber: '',
        tenancyId: tenancy.id,
        amount,
        date,
        time: `${pad(between(7, 20))}:${pad(between(0, 59))}`,
        method,
        reference: method === 'M-Pesa' ? mpesaRef() : bankRef(date),
      });
    }
  }
}

// Receipt numbers follow the order money arrived, per company.
seed.payments.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
const scenarioOf = (tenancyId: string) => scenarios.find((s) => s.tenancy.id === tenancyId)!;
const receiptBase: Record<string, number> = { [COMPANY_ID]: 300, [SV]: 100, acacia: 0 };
for (const company of companies) {
  let sequence = receiptBase[company.id];
  for (const p of seed.payments.filter((x) => companyOfScenario(scenarioOf(x.tenancyId)) === company.id)) {
    sequence += 1;
    p.receiptNumber = `RCT-${p.date.slice(2, 4)}${p.date.slice(5, 7)}-${String(sequence).padStart(4, '0')}`;
  }
  company.sequences.receipt = sequence;
}

// Repairs and messages (previously typed separately into each app).
const unitOf = (tenancyId: string) => seed.tenancies.find((t) => t.id === tenancyId)!.unitId;
const ticket = (t: Omit<RepairTicket, 'companyId' | 'unitId'>, companyId = COMPANY_ID): RepairTicket => ({
  companyId,
  unitId: unitOf(t.tenancyId),
  ...t,
});
seed.repairTickets = [
  ticket({ id: 'MT-1047', tenancyId: 'L-2172', category: 'plumbing', priority: 'high', status: 'open', title: 'Kitchen sink leaking under cabinet', description: 'Leaking quite badly under the sink. A bucket is catching it for now.', hasPhoto: true, createdAt: '2026-10-06T07:40:00+03:00', resolvedAt: null, assignedTo: null, resolutionNote: null }),
  ticket({ id: 'MT-1046', tenancyId: 'L-2166', category: 'electrical', priority: 'low', status: 'open', title: 'Corridor light out on 2nd floor', description: 'The corridor light outside 207 has been off for two nights.', hasPhoto: false, createdAt: '2026-10-05T19:12:00+03:00', resolvedAt: null, assignedTo: null, resolutionNote: null }),
  ticket({ id: 'MT-1044', tenancyId: 'L-2150', category: 'plumbing', priority: 'medium', status: 'in_progress', title: 'Water heater not heating', description: 'Shower water stays cold even after an hour.', hasPhoto: false, createdAt: '2026-09-28T08:05:00+03:00', resolvedAt: null, assignedTo: 'Otieno Fundi Services', resolutionNote: null }),
  ticket({ id: 'MT-1041', tenancyId: 'L-2207', category: 'carpentry', priority: 'low', status: 'in_progress', title: 'Balcony door lock stiff', description: 'The balcony door lock is hard to turn.', hasPhoto: false, createdAt: '2026-09-26T17:30:00+03:00', resolvedAt: null, assignedTo: 'Otieno Ouma (caretaker)', resolutionNote: null }),
  ticket({ id: 'MT-1039', tenancyId: 'L-2160', category: 'electrical', priority: 'high', status: 'resolved', title: 'Socket in bedroom sparks', description: 'The socket by the bed sparks when anything is plugged in.', hasPhoto: true, createdAt: '2026-09-22T21:10:00+03:00', resolvedAt: '2026-09-24T11:00:00+03:00', assignedTo: 'Otieno Fundi Services', resolutionNote: 'Socket and faceplate replaced.' }),
  ticket({ id: 'MT-1038', tenancyId: 'L-2154', category: 'security', priority: 'medium', status: 'resolved', title: 'Gate remote not working', description: 'The gate remote stopped opening the main gate.', hasPhoto: false, createdAt: '2026-09-20T07:15:00+03:00', resolvedAt: '2026-09-22T10:30:00+03:00', assignedTo: 'Achieng Atieno (caretaker)', resolutionNote: 'Remote reprogrammed and battery replaced.' }),
  // Savanna numbers its own tickets.
  ticket({ id: 'MT-2002', tenancyId: 'SV-102', category: 'plumbing', priority: 'medium', status: 'open', title: 'Bathroom tap dripping', description: 'The bathroom tap drips all night.', hasPhoto: false, createdAt: '2026-10-04T20:15:00+03:00', resolvedAt: null, assignedTo: null, resolutionNote: null }, SV),
  ticket({ id: 'MT-2001', tenancyId: 'SV-101', category: 'electrical', priority: 'low', status: 'resolved', title: 'Kitchen bulb holder loose', description: 'The bulb holder in the kitchen is hanging loose.', hasPhoto: false, createdAt: '2026-09-12T09:00:00+03:00', resolvedAt: '2026-09-13T16:00:00+03:00', assignedTo: 'Kamau Ndirangu (caretaker)', resolutionNote: 'Holder refitted.' }, SV),
];
for (const company of companies) {
  // Companies with no tickets yet start their numbering at 0.
  company.sequences.repairTicket = Math.max(
    0,
    ...seed.repairTickets.filter((t) => t.companyId === company.id).map((t) => Number(t.id.split('-')[1])),
  );
}
const message = (m: Omit<Message, 'companyId'>, companyId = COMPANY_ID): Message => ({ companyId, ...m });
seed.messages = [
  message({ id: 'msg-101', tenancyId: 'L-2172', sender: 'tenant', staffId: null, body: 'Hi, the kitchen sink is leaking quite badly. I have put a bucket under it.', sentAt: '2026-10-06T07:41:00+03:00', readByStaffAt: '2026-10-06T07:50:00+03:00' }),
  message({ id: 'msg-102', tenancyId: 'L-2172', sender: 'staff', staffId: 's-njoki', body: 'Thanks Lucy. I have logged it as MT-1047. A plumber will come by before noon.', sentAt: '2026-10-06T07:55:00+03:00', readByStaffAt: null }),
  message({ id: 'msg-103', tenancyId: 'L-2172', sender: 'tenant', staffId: null, body: 'Okay, I will be home. Thank you.', sentAt: '2026-10-06T08:02:00+03:00', readByStaffAt: null }),
  message({ id: 'msg-201', tenancyId: 'L-2160', sender: 'tenant', staffId: null, body: 'I sent the renewal back with a question about the 5% increase. Can we discuss?', sentAt: '2026-10-05T18:20:00+03:00', readByStaffAt: '2026-10-06T09:05:00+03:00' }),
  message({ id: 'msg-202', tenancyId: 'L-2160', sender: 'staff', staffId: 's-njoki', body: 'Hi David, the increase matches the market review for Riverside Court. Happy to keep the deposit as is so nothing extra is due.', sentAt: '2026-10-06T09:12:00+03:00', readByStaffAt: null }),
  message({ id: 'msg-301', tenancyId: 'L-2185', sender: 'tenant', staffId: null, body: 'I will clear half by Friday and the rest by the 20th.', sentAt: '2026-10-05T20:45:00+03:00', readByStaffAt: null }),
  message({ id: 'msg-901', tenancyId: 'SV-102', sender: 'tenant', staffId: null, body: 'Hello, the bathroom tap is dripping all night. Can someone look at it?', sentAt: '2026-10-04T20:16:00+03:00', readByStaffAt: '2026-10-05T08:00:00+03:00' }, SV),
  message({ id: 'msg-902', tenancyId: 'SV-102', sender: 'staff', staffId: 's-wanjiru', body: 'Hi Naliaka, Kamau will pass by tomorrow morning to fix it.', sentAt: '2026-10-05T08:10:00+03:00', readByStaffAt: null }, SV),
];

// Parity fixture: numbers only, labels are formatted per platform.
const expected = Object.fromEntries(
  seed.tenancies.map((t) => [
    t.id,
    buildLedger(seed, t).map((b) => ({
      month: b.month,
      kind: b.kind,
      rent: b.rent,
      rentDays: b.rentDays ? b.rentDays.days : null,
      waterUnits: b.water?.units ?? null,
      water: b.water?.amount ?? 0,
      garbage: b.garbage,
      deposit: b.deposit,
      depositApplied: b.depositApplied,
      depositRefund: b.depositRefund,
      balanceBf: b.balanceBf,
      newCharges: b.newCharges,
      totalDue: b.totalDue,
      amountPaid: b.amountPaid,
      outstanding: b.outstanding,
      status: b.status,
      datePaid: b.datePaid,
    })),
  ]),
);

writeFileSync(resolve(root, 'shared/billing-seed.json'), JSON.stringify(seed, null, 2) + '\n');
writeFileSync(resolve(root, 'shared/billing-expected.json'), JSON.stringify(expected, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Database rows (snake_case, every table carries company_id) for Supabase.
// supabase/seed.sql is built from these, and both apps' row mappers are
// tested against shared/supabase-rows.json, so the database, the admin and
// the app all start from identical data.

const companyOfUnit = (unitId: string) =>
  seed.properties.find((p) => p.id === seed.units.find((u) => u.id === unitId)!.propertyId)!.companyId;
const companyOfTenancyId = (tenancyId: string) => companyOfUnit(seed.tenancies.find((t) => t.id === tenancyId)!.unitId);
const rows = {
  companies: companies.map((c) => ({
    id: c.id, slug: c.slug, name: c.name, kra_pin: c.kraPin, mpesa_paybill: c.mpesaPaybill,
    bank_name: c.bankName, bank_account: c.bankAccount, settings: c.settings, sequences: c.sequences,
    subscription: c.subscription,
  })),
  staff: seed.staff.map((s) => ({
    id: s.id, company_id: s.companyId, name: s.name, role: s.role, phone: s.phone, property_ids: s.propertyIds,
  })),
  properties: seed.properties.map((p) => ({
    id: p.id, company_id: p.companyId, manager_id: p.managerId, name: p.name, type: p.type, address: p.address,
    account_prefix: p.accountPrefix, water_rate: p.waterRate, garbage_fee: p.garbageFee, rate_history: p.rateHistory,
  })),
  units: seed.units.map((u) => ({
    id: u.id, company_id: companyOfUnit(u.id), property_id: u.propertyId, label: u.label, bedrooms: u.bedrooms,
  })),
  tenants: seed.tenants.map((t) => ({ id: t.id, company_id: t.companyId, name: t.name, phone: t.phone, email: t.email })),
  tenancies: seed.tenancies.map((t) => ({
    id: t.id, company_id: companyOfUnit(t.unitId), tenant_id: t.tenantId, unit_id: t.unitId, rent: t.rent,
    deposit: t.deposit, move_in: t.moveIn, move_out: t.moveOut, lease_start: t.leaseStart, lease_end: t.leaseEnd,
    opening_balance: t.openingBalance, opening_reading: t.openingReading, renewal: t.renewal,
    move_out_note: t.moveOutNote, deposit_refund: t.depositRefund,
  })),
  meter_readings: Object.entries(seed.meterReadings).flatMap(([unitId, byMonth]) =>
    Object.entries(byMonth).map(([month, value]) => ({ company_id: companyOfUnit(unitId), unit_id: unitId, month, value })),
  ),
  payments: seed.payments.map((p) => ({
    receipt_number: p.receiptNumber, company_id: companyOfTenancyId(p.tenancyId), tenancy_id: p.tenancyId,
    amount: p.amount, date: p.date, time: p.time, method: p.method, reference: p.reference,
  })),
  repair_tickets: seed.repairTickets.map((t) => ({
    id: t.id, company_id: t.companyId, tenancy_id: t.tenancyId, unit_id: t.unitId, category: t.category,
    priority: t.priority, status: t.status, title: t.title, description: t.description, has_photo: t.hasPhoto,
    created_at: t.createdAt, resolved_at: t.resolvedAt, assigned_to: t.assignedTo, resolution_note: t.resolutionNote,
  })),
  messages: seed.messages.map((m) => ({
    id: m.id, company_id: m.companyId, tenancy_id: m.tenancyId, sender: m.sender, staff_id: m.staffId,
    body: m.body, sent_at: m.sentAt, read_by_staff_at: m.readByStaffAt,
  })),
};
writeFileSync(resolve(root, 'shared/supabase-rows.json'), JSON.stringify(rows, null, 2) + '\n');

// Literal for Postgres: strings quoted, objects as jsonb, arrays as text[].
function sqlValue(v: unknown, column: string): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && column === 'property_ids') {
    return `array[${v.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(', ')}]::text[]`;
  }
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
// Parents before children so foreign keys hold.
const tableOrder: Array<keyof typeof rows> = [
  'companies', 'staff', 'properties', 'units', 'tenants', 'tenancies', 'meter_readings', 'payments', 'repair_tickets', 'messages',
];
const sql = [
  '-- GENERATED by shared/seed/generate.ts from shared/billing-seed.json. Do not edit by hand.',
  '-- Demo data for Makazi: HarborRidge Limited, Savanna Homes Ltd and Acacia Rentals (empty).',
  '-- Logins are created separately (supabase/scripts/create-demo-users.mjs).',
  '',
  ...tableOrder.flatMap((table) => {
    const list = rows[table] as Array<Record<string, unknown>>;
    if (!list.length) return [];
    const cols = Object.keys(list[0]);
    return [
      `insert into public.${table} (${cols.join(', ')}) values`,
      list.map((r) => `  (${cols.map((c) => sqlValue(r[c], c)).join(', ')})`).join(',\n') + ';',
      '',
    ];
  }),
].join('\n');
mkdirSync(resolve(root, 'supabase'), { recursive: true });
writeFileSync(resolve(root, 'supabase/seed.sql'), sql);

// The tenant app only ever sees its own tenancy, of its own company. One
// slice per demo account; Phase 2 replaces this with RLS-scoped queries.
function tenantSlice(tenancyId: string) {
  const tenancy = seed.tenancies.find((t) => t.id === tenancyId)!;
  const unit = seed.units.find((u) => u.id === tenancy.unitId)!;
  const property = seed.properties.find((p) => p.id === unit.propertyId)!;
  return {
    asOf: seed.asOf,
    companies: companies.filter((c) => c.id === property.companyId),
    properties: [property],
    units: [unit],
    tenants: seed.tenants.filter((t) => t.id === tenancy.tenantId),
    tenancies: [tenancy],
    meterReadings: { [unit.id]: seed.meterReadings[unit.id] },
    payments: seed.payments.filter((p) => p.tenancyId === tenancyId),
    // Only the manager of the tenant's property; no other staff details.
    staff: seed.staff.filter((s) => s.id === property.managerId),
    repairTickets: seed.repairTickets.filter((t) => t.tenancyId === tenancyId),
    messages: seed.messages.filter((m) => m.tenancyId === tenancyId),
  };
}
// A current tenant at each landlord, plus a former tenant (read-only access).
const demoTenancies = ['L-2160', 'SV-102', 'L-2071'];
const slices = demoTenancies.map((id) => {
  const tenancy = seed.tenancies.find((t) => t.id === id)!;
  const phone = seed.tenants.find((t) => t.id === tenancy.tenantId)!.phone.replace(/\s/g, '');
  return `  '+254${phone.slice(1)}': r'''\n${JSON.stringify(tenantSlice(id), null, 2)}\n''',`;
});
const dart = `// GENERATED by shared/seed/generate.ts. Do not edit by hand.
// One slice of shared/billing-seed.json per demo tenant, keyed by phone.
// Each holds a single tenancy and its own company only. In Phase 2 this
// comes from Supabase, scoped to the signed-in tenant by RLS.

const Map<String, String> kTenantSeedsByPhone = {
${slices.join('\n')}
};

/// The slice used when no one has signed in yet (tests, previews).
const String kDefaultTenantPhone = '${'+254' + seed.tenants.find((t) => t.id === 't-david')!.phone.replace(/\s/g, '').slice(1)}';
`;
writeFileSync(resolve(root, 'lib/core/billing/seed/tenant_seed.g.dart'), dart);

console.log(
  `Seed written: ${companies.length} companies, ${seed.tenancies.length} tenancies, ${seed.payments.length} payments; ` +
    companies.map((c) => `${c.slug} receipts to ${c.sequences.receipt}, tickets to ${c.sequences.repairTicket}`).join('; '),
);
