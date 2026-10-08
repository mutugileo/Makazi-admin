# App ↔ admin alignment

Makazi has two front ends: the tenant app (Flutter, repo root) and the admin
(Astro, `PropAdmin/`). This is the checklist that keeps them saying the same
thing. "Guard" is what fails if they drift.

| Aspect | Tenant app | Admin | Guard |
| --- | --- | --- | --- |
| Data | One tenancy slice per signed-in tenant (`tenant_seed.g.dart`) | `getPortfolio(companyId)` | Same `shared/billing-seed.json`; `billing_parity_test.dart` |
| Bill maths (rent, water, garbage, b/f, deposits, proration, grace, final bills, effective-dated rates) | `billing_engine.dart` | `lib/billing.ts` | Parity test over every tenancy |
| Companies | Only the tenant's landlord | Only the signed-in company | Isolation tests (app) + per-company checks (admin) |
| Bill status | Paid · Partial · Unpaid · Credit | Same | Shared colours test |
| Grace wording | "Grace period to 20 Oct", "Overdue since 20 Oct" | "Grace period to 20 Oct", "N days overdue" | Copy |
| Repairs | Categories, statuses, MT- numbering from the shared seed; former tenants can't raise requests | Same board and vocabulary | Parity test (tickets) |
| Messages | One thread per tenancy; manager from the property | Same threads; unread count | Parity test (messages) |
| Times | "Today, 09:12" · "Yesterday" · "5 Oct" | Same | Copy |
| Receipt | Company, KRA PIN, amount, Receipt, Tenant, Unit, Date + time, Method, Reference, For | Same fields, order and labels | Copy |
| Statement of payments | Payments → Statement | `/statement/[id]` (printable) | Same totals (billed, paid, balance) |
| Former tenants | Read-only; "Records until …"; no paying or new repairs | Former tab; "Records kept until …" | Same 6-month (per-company) rule |
| PDF download | "Not available yet" | "Not available yet" | No fake success |
| Leases | Hidden (`kLeasesEnabled`) | Hidden (`FEATURES.leases`) | Both switches off |
| Greeting | "Habari, David" | "Habari, …" | Copy |
| Brand | Makazi mark, Newsreader + Nunito Sans | Same | `design_tokens_test.dart`; icons from `shared/brand/make_icons.py` |
| Before sign-in | Makazi platform branding | Makazi platform branding | No landlord name before sign-in |
| Sign-in | Phone + password, then PIN | Email + password | `shared/AUTH.md` |

Intentional differences (by role, not drift):

- Repair **priority** is staff-only; tenants don't set or see it.
- Tenants see **one** tenancy; staff see the whole company.
- Only staff can record meter readings, change rates, onboard, move out or
  reset passwords.
