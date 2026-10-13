// Requests from SCCE's nightly collector are signed with a secret both sides
// hold (SCCE_EXPORT_SECRET). The signature covers the time and the exact
// path and query, so a captured request can't be replayed later or reused
// for a different month range.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How far the collector's clock may be from ours. */
export const MAX_SKEW_SECONDS = 300;

export function signatureFor(secret: string, timestamp: string, method: string, pathAndQuery: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${method.toUpperCase()}.${pathAndQuery}`).digest('hex');
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifySignature(
  secret: string,
  headers: Headers,
  method: string,
  pathAndQuery: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): SignatureCheck {
  const timestamp = headers.get('x-scce-timestamp') ?? '';
  const given = headers.get('x-scce-signature') ?? '';
  if (!/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(given)) {
    return { ok: false, reason: 'Missing or malformed signature headers' };
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'Request timestamp is too old or in the future' };
  }
  const expected = Buffer.from(signatureFor(secret, timestamp, method, pathAndQuery), 'hex');
  const actual = Buffer.from(given, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'Signature does not match' };
  }
  return { ok: true };
}
