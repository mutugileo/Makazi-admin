#!/usr/bin/env node
// Sets the 4-digit app PIN for an existing tenant login (developer and test
// accounts, or a tenant who can't receive a reset). The PIN is read from
// stdin so it never appears in shell history or `ps`:
//
//   printf '%s' 1234 | node scripts/set-tenant-pin.mjs --phone 0712345678
//
// Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from PropAdmin/.env. The
// login must already exist; nothing is created.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]),
);

const i = process.argv.indexOf('--phone');
const rawPhone = i > -1 ? process.argv[i + 1] ?? '' : '';
const digits = rawPhone.replace(/\D/g, '');
const local = digits.startsWith('254') ? `0${digits.slice(3)}` : digits;
if (!/^0[17]\d{8}$/.test(local)) {
  console.error('Pass a Kenyan mobile number: --phone 07XXXXXXXX');
  process.exit(1);
}
const email = `254${local.slice(1)}@tenant.makazi.app`;

const pin = readFileSync(0, 'utf8').trim();
if (!/^\d{4}$/.test(pin)) {
  console.error('Pipe in a 4-digit PIN on stdin.');
  process.exit(1);
}

const url = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in PropAdmin/.env');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

let found = null;
for (let page = 1; !found; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  found = data.users.find((u) => u.email === email) ?? null;
  if (data.users.length < 200) break;
}
if (!found) {
  console.error(`No app login for ${local}. Onboard the tenant first.`);
  process.exit(1);
}

// The app signs a 4-digit PIN in as `makazi-pin-XXXX` (see supabase_auth_repository.dart).
const { error } = await supabase.auth.admin.updateUserById(found.id, { password: `makazi-pin-${pin}` });
if (error) {
  console.error(`Couldn't set the PIN: ${error.message}`);
  process.exit(1);
}
console.log(`PIN set for ${local}. Sign in on the app with this number and the PIN.`);
