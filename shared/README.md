# Shared billing model

Makazi is a multi-company platform (built and maintained by Codzure
Solutions Ltd). HarborRidge Limited is the first landlord; the seed also has
a second demo landlord, Savanna Homes Ltd, so tests prove the two never mix.

## Companies

- Every record belongs to one company (`companyId` on properties, tenants,
  staff, repair tickets and messages; units, tenancies, readings and
  payments belong through their property).
- **Per-company settings** (`company.settings`): first month on Makazi
  (`ledgerStartMonth`), due day, grace day, deposit by bedrooms, and how long
  former tenants' records are kept. Water and garbage rates are per property.
- **Per-company numbering** (`company.sequences`): receipts (RCT-) and repair
  tickets (MT-) count separately for each company.
- **Plan** (`company.subscription`): plan, status, unit and staff limits,
  trial end. Stored and shown in the admin's Settings; not enforced or billed
  yet.
- **Admin**: one shared sign-in page. Each user belongs to a company and
  every page is built from `getPortfolio(companyId)` (a scoped slice, the
  stand-in for row-level security). `company.slug` is reserved for per-company
  web addresses later.
- **Tenant app**: before sign-in it shows the Makazi brand only. After sign-in
  it loads that tenant's slice: one tenancy and one company.

The owner's spreadsheet (one row per tenant per month) is the contract both
surfaces implement. The tenant app (Flutter, repo root) and the admin
(`PropAdmin/`, Astro) read the same seed and apply the same rules.

| File | What it is |
| --- | --- |
| `billing-seed.json` | Everything both apps show, for every company: companies (settings, numbering, plan), properties, units, tenants, staff, tenancies, meter readings, payments, repair tickets and messages. |
| `billing-expected.json` | Bills computed by the TypeScript engine. The Dart engine is tested against it (`test/unit/billing_parity_test.dart`). |
| `seed/generate.ts` | Regenerates both files plus one app slice per demo tenant (`lib/core/billing/seed/tenant_seed.g.dart`). Each company has its own random stream, so adding a company never changes another's numbers. Run `node shared/seed/generate.ts` (Node 23.6+). |

Engines: `PropAdmin/src/lib/billing.ts` and `lib/core/billing/billing_engine.dart`.

Shared vocabularies (same wire values in both apps and, later, the database):

- Bill status: `Paid` · `Partial` · `Unpaid` · `Credit`
- Repair category: `plumbing` · `electrical` · `carpentry` · `appliance` · `security` (shown as "Security & access")
- Repair priority: `low` · `medium` · `high` (staff set it; new requests start at medium)
- Repair status: `open` · `in_progress` · `resolved`
- Staff role: `owner` · `manager` · `caretaker`; each property has a `managerId`, who is the person tenants chat with
- Messages: one thread per tenancy; `readByStaffAt` drives the admin's unread count

Colours: `PropAdmin/src/styles/global.css` (@theme) is the palette; the app's
`AppColors` must match it (`test/unit/design_tokens_test.dart`).
Change both together, regenerate, and run `flutter test`.

## Spreadsheet column mapping

| Owner's column | Model |
| --- | --- |
| Tenant, Unit, Phone number | `tenants`, `units` (unit belongs to a property; property has a `type`: apartments or houses) |
| Month | `MonthlyBill.month` (`YYYY-MM`) |
| Monthly rent | `rent` line |
| Water bill per unit | `property.waterRate` |
| Units consumed | current reading − previous reading (`meterReadings`, taken on the 1st) |
| Total water bill | `water` line = units × rate |
| Garbage bill | `property.garbageFee` |
| *(new)* Balance b/f | previous month's amount outstanding (negative = credit) |
| Total due | balance b/f + this month's lines |
| Amount paid, Date paid | payments dated in that month (date paid = latest) |
| Status | `Paid` (0 left), `Partial` (paid something, still owing), `Unpaid` (nothing paid), `Credit` (overpaid) |
| Amount outstanding | total due − amount paid, carried to next month |

## Rules

HarborRidge's values are shown; each company sets its own in `company.settings`.

1. **Bills are issued on the 1st, due on the 5th, overdue after the 20th** (`dueDay`, `graceDay`). Between the 5th and the 20th a bill is in its grace period: the tenant still owes it but isn't counted as overdue. No late fee.
2. **Water on month M's bill is the previous month's use**: the caretaker's reading for the 1st of M minus the previous reading. The rate is set per property (currently KES 150 per unit everywhere).
3. **Garbage** is a flat monthly fee set per property (currently KES 250 everywhere).
   **Rates are effective-dated** (`property.rateHistory`): each bill uses the water and garbage rates in force for its month, so changing a rate never re-prices past bills. In the demo, Ngong Road Residences moved from KES 130 to 150 per unit of water in September 2026.
4. **Rent, water and garbage are paid to the same account** (Paybill, account = unit code). There is no separate water deposit.
5. **Deposit by unit size** (`depositSchedule`): KES 25,000 for 1 bedroom, KES 30,000 for 2 bedrooms.
6. **Move-in bill**: deposit + rent for the days left in the month, counting the move-in day (`rent × days ÷ days in month`, rounded to the shilling) + garbage. No water yet; the move-in meter reading is the opening reading. Normal bills start the month after.
7. **Deposits are not income.** Collections exclude the part of a payment that covered a deposit.
8. **Carry forward**: whatever is unpaid (or overpaid) at month end becomes next month's balance b/f.
9. **Move-out** never deletes anything. The unit shows Vacant and the tenant moves to Former tenants. The month after move-out gets a **final bill**: last water reading, deposit applied against the balance, and a refund line if the deposit was more than what was owed.
10. **Records are kept for 6 months after move-out** (`recordRetentionMonths`) so the owner can issue a payment statement (e.g. proof of rent for a tenant's employer). After that they are due for archiving.
11. **Arrears ageing**: payments clear the oldest charges first, so the balance still owed belongs to the newest bills. Days overdue are counted from the end of each bill's grace period.
12. **Opening balances**: tenancies older than `startMonth` carry in a balance from the spreadsheet (`openingBalance`).

## Confirmed by the owner (October 2026)

Deposits 25,000 / 30,000 by bedrooms · water 150 per unit, set per property · garbage 250, set per property · due the 5th with grace to the 20th · move-in rent prorated by days · caretaker reads meters · records kept 6 months after move-out for payment checks.

## Still open

- **Rents**: the seed uses placeholder rents (KES 20,000 to 32,000). Replace them with the owner's rent roll.
- **Move-out mid-month**: is the last month prorated too? Currently the full month is charged.
- **Garbage on a mid-month move-in**: currently the full KES 250.
- **Penalties after the 20th**: none for now.
