# Sign-in and access

No SMS, no email codes, no Google sign-in: everything runs on Supabase's
free auth features. Accounts are invite-only.

## Who signs in, and how

| Who | Where | Sign-in | Day to day |
| --- | --- | --- | --- |
| Tenant | Makazi app | Phone number + password | 4-digit app PIN |
| Former tenant | Makazi app | Same, read-only until 6 months after move-out | Same |
| Caretaker | Makazi app (caretaker mode) | Phone number + password | 4-digit app PIN |
| Property manager | Admin website | Email + password + authenticator app | Same |
| Owner | Admin website | Email + password + authenticator app | Same |

## Tenant journey

1. **Onboarding** (manager, admin): an Edge Function using the service role
   creates the Supabase user with the tenant's phone number already
   confirmed (no SMS is sent), a random one-time password, and
   `app_metadata.must_change_password = true` plus an expiry 72 hours out.
   The manager passes the password on in person or via their own WhatsApp.
2. **First sign-in** (app): phone + one-time password, then the tenant must
   choose their own password (at least 8 characters, not their phone
   number). Until they do, access rules return no data.
3. **PIN**: the tenant sets a 4-digit PIN for this phone. The PIN never leaves
   the device. The session is stored in the Keychain/Keystore
   (`flutter_secure_storage`) with a salted hash of the PIN. The app locks
   after 1 minute in the background; 5 wrong PINs wipe the session and
   require the password again.
4. **Forgot password**: the manager issues a new one-time password (Tenants →
   Reset password). The old password and all signed-in phones stop working.
   This is the only reset path, so there is no SMS or email cost.
5. **Move-out**: access becomes read-only and ends 6 months after move-out,
   when the records are archived.

The prototype implements steps 2 to 4 against an in-memory demo
(`lib/features/auth/data/`). Phase 2 swaps `DemoAuthRepository` for a
Supabase one; the screens and rules stay the same.

## Admin sign-in until Supabase

The admin site runs on the server (`output: 'server'`, Node adapter), and
`src/middleware.ts` redirects anyone without a valid session to `/login`.
No tenant data is in any prebuilt file.

- One local admin in `PropAdmin/.env`, created by `npm run admin:create`:
  generated password, stored only as a scrypt hash.
- HMAC-signed session cookie: HttpOnly, SameSite=Lax, Secure over HTTPS,
  12 hours. Signed-in pages are sent with `Cache-Control: no-store`.
- Astro's origin check blocks cross-site form posts. Sign-out is POST only.
  Only same-site paths are allowed in `?next=` (no open redirects).
- 5 failed sign-ins per email and IP lock that pair out for 15 minutes.
- Code: `PropAdmin/src/lib/auth/`, `src/pages/login.astro`,
  `src/pages/logout.ts`.

Phase 2 swaps `lib/auth/session.ts` for Supabase sessions (`@supabase/ssr`)
and adds the authenticator-app step. The middleware and login page stay.

## Supabase settings (Phase 2)

- Disable public sign-ups. Enable the phone provider with confirmations
  **off**; no SMS provider is configured. Accounts come only from the
  onboarding Edge Function.
- Minimum password length 8.
- Staff: email provider plus TOTP MFA. Access rules for staff require
  `auth.jwt()->>'aal' = 'aal2'`, so a stolen password alone gets nothing.
  Add a free CAPTCHA (Cloudflare Turnstile) to the admin sign-in.
- Roles live in a `memberships` table (user, company, role, property) that
  only the company's owner can change, never in `user_metadata` (users can
  edit that). One login per person across Makazi; access is per company.
- Every table carries `company_id`; access rules check it through
  memberships, and database tests prove one company's users can't read or
  write another's rows. Codzure support access is a separate, audited
  platform-admin role.
- Row-level security:
  - tenants read only their own tenancy's bills, payments, repairs and
    messages, and nothing while `must_change_password` is true or the
    one-time password has expired;
  - the caretaker can add meter readings and update repairs for their
    properties, with no access to money or tenant phone numbers;
  - nobody can insert payments from a client. Only the M-Pesa callback
    (service role) writes them.
- The admin site must load data after sign-in with the user's own session
  instead of building it into static pages.
- Audit log: password resets, phone-number changes, move-outs, deposit
  refunds and balance corrections, with who did them.
