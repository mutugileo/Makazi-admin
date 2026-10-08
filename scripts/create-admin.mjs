#!/usr/bin/env node
// Creates (or replaces) the local admin account in PropAdmin/.env.
//
//   npm run admin:create -- --email you@example.com --name "Your Name" [--company harborridge]
//
// A strong password is generated and printed once. To choose your own, pipe
// it in (it is never passed as an argument, so it stays out of `ps`):
//
//   printf '%s' 'your password' | npm run admin:create -- --email … --password-stdin
//
// Only the scrypt hash is stored. Re-running replaces the admin and signs
// everyone out.

import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const email = arg('email', 'admin@harborridge.local').trim().toLowerCase();
const name = arg('name', 'Admin').trim();
const scriptDir = dirname(fileURLToPath(import.meta.url));
const localSeedPath = resolve(scriptDir, '../shared/billing-seed.json');
const seedPath = existsSync(localSeedPath)
  ? localSeedPath
  : resolve(scriptDir, '../../shared/billing-seed.json');
const knownCompanies = JSON.parse(readFileSync(seedPath, 'utf8')).companies.map((c) => c.id);
if (!knownCompanies.includes(companyId)) {
  console.error(`Unknown company "${companyId}". Choose one of: ${knownCompanies.join(', ')}`);
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+$/.test(email)) {
  console.error(`Not an email address: ${email}`);
  process.exit(1);
}

const chosen = process.argv.includes('--password-stdin');
let password;
if (chosen) {
  password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  if (password.length < 12) {
    console.error('Choose a password of at least 12 characters.');
    process.exit(1);
  }
} else {
  // Readable password: no 0/O or 1/l/I.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const raw = [...randomBytes(18)].map((b) => alphabet[b % alphabet.length]).join('');
  password = `${raw.slice(0, 6)}-${raw.slice(6, 12)}-${raw.slice(12, 18)}`;
}

const N = 16384, r = 8, p = 1;
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, { N, r, p });
// ':' separators: .env loaders would expand '$' as variable references.
const passwordHash = `scrypt:${N}:${r}:${p}:${salt.toString('base64')}:${hash.toString('base64')}`;

const values = {
  ADMIN_EMAIL: email,
  ADMIN_NAME: name,
  ADMIN_COMPANY_ID: companyId,
  ADMIN_PASSWORD_HASH: passwordHash,
  // New secret each time, which signs out existing sessions.
  SESSION_SECRET: randomBytes(48).toString('base64url'),
};

const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split('\n') : [];
const kept = lines.filter((line) => !Object.keys(values).some((k) => line.startsWith(`${k}=`)));
while (kept.length && kept[kept.length - 1] === '') kept.pop();
const quote = (v) => `"${String(v).replace(/"/g, '\\"')}"`;
const next = [...kept, ...Object.entries(values).map(([k, v]) => `${k}=${quote(v)}`), ''].join('\n');
writeFileSync(envPath, next, { mode: 0o600 });

console.log('\nLocal admin saved to PropAdmin/.env (git-ignored).\n');
console.log(`  Company:   ${companyId}`);
console.log(`  Email:     ${email}`);
if (chosen) {
  console.log('  Password:  (the one you entered)\n');
} else {
  console.log(`  Password:  ${password}\n`);
  console.log('This password is shown once. Store it in your password manager.');
}
console.log('Restart the dev server if it is running.\n');
