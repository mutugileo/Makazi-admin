# Makazi-admin

Staff dashboard for the Makazi property management platform. Built with Astro, TypeScript, Tailwind CSS, and Supabase. Rendered on the server with full authentication and session management.

Billing data and schemas are located in `shared/` (see `shared/README.md`).

## First run

```sh
npm install
npm run admin:create -- --email you@example.com --name "Your Name" --company harborridge
npm run dev
```

`admin:create` writes the local admin to `.env` (git-ignored): the email, the company they work for (`--company`, a company id from `shared/billing-seed.json`, default `harborridge`), a scrypt hash of a generated password, and a session secret. The admin only ever shows that company's data. The password is printed once, so save it in a password manager. To choose your own password (at least 12 characters), pipe it in instead:

```sh
printf '%s' 'your password' | npm run admin:create -- --email you@example.com --name "Your Name" --password-stdin
```

Run it again to replace the admin or reset the password; that also signs everyone out.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:4321 |
| `npm run build` | Server build to `dist/` |
| `npm run preview` | Preview production build |
| `npm start` | Run the build, loading `.env` |
| `npm run admin:create` | Create or replace the local admin |

## Sign-in & Authentication

This local admin uses scrypt password hashing for rapid local testing and development. Supabase Auth (email, password, and authenticator app) integrates for production multi-tenant environments; see `shared/AUTH.md`.
