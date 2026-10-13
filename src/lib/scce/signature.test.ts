import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signatureFor, verifySignature } from './signature';

const secret = 'a'.repeat(40);
const path = '/api/scce/features?from=2025-10&to=2026-09';
const now = 1_791_800_000;

const headers = (timestamp: string, signature: string) =>
  new Headers({ 'x-scce-timestamp': timestamp, 'x-scce-signature': signature });

test('accepts a fresh request signed with the shared secret', () => {
  const ts = String(now - 10);
  assert.deepEqual(verifySignature(secret, headers(ts, signatureFor(secret, ts, 'GET', path)), 'GET', path, now), { ok: true });
});

test('rejects a different secret, an edited query or a stale timestamp', () => {
  const ts = String(now);
  const good = signatureFor(secret, ts, 'GET', path);
  assert.equal(verifySignature('b'.repeat(40), headers(ts, good), 'GET', path, now).ok, false);
  assert.equal(verifySignature(secret, headers(ts, good), 'GET', path.replace('2025-10', '2024-10'), now).ok, false);
  const old = String(now - 301);
  assert.equal(verifySignature(secret, headers(old, signatureFor(secret, old, 'GET', path)), 'GET', path, now).ok, false);
});

test('rejects missing headers', () => {
  assert.equal(verifySignature(secret, new Headers(), 'GET', path, now).ok, false);
});

test('matches the vector SCCE signs with (SCCE engine test/signing.test.ts)', () => {
  assert.equal(
    signatureFor('k'.repeat(40), '1791800000', 'GET', '/api/scce/features?from=2025-10&to=2026-09'),
    'd7c791df2901ca52043ccbd85ec652b120ce1896f439628bbe6c53822c50b860',
  );
});
