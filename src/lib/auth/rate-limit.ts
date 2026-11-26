// In-memory throttles, per server instance. Enough to slow guessing and
// runaway clicks; Supabase Auth rate-limits sign-ins on its side as well.

const MAX_KEYS = 10_000;

/**
 * Keeps the map under MAX_KEYS without ever dropping an active lock: expired
 * keys go first, then the keys with the fewest failures (so partial counts
 * survive longer than one-off junk). Returns false when the map is still full
 * of active locks; callers then fail closed rather than forget a lock.
 */
function prune(map: Map<string, number[]>, windowMs: number, isLocked: (key: string, count: number) => boolean = () => false): boolean {
  if (map.size <= MAX_KEYS) return true;
  const now = Date.now();
  for (const [key, list] of map) {
    if (list.length === 0 || now - list[list.length - 1] >= windowMs) map.delete(key);
  }
  if (map.size <= MAX_KEYS) return true;
  // Trim to 90% of the cap so the sort runs once per ~1,000 new keys, not on
  // every failure while the map sits at the cap.
  const target = Math.floor(MAX_KEYS * 0.9);
  const evictable = [...map].filter(([key, list]) => !isLocked(key, list.length)).sort((a, b) => a[1].length - b[1].length);
  for (const [key] of evictable) {
    if (map.size <= target) break;
    map.delete(key);
  }
  return map.size <= MAX_KEYS;
}

function recentIn(map: Map<string, number[]>, key: string, windowMs: number): number[] {
  const now = Date.now();
  const list = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length === 0) map.delete(key);
  else map.set(key, list);
  return list;
}

// ---- Sign-in lockout -------------------------------------------------------
// Within 15 minutes: 5 failures for one email from one IP lock that pair;
// 20 from one IP (any email) lock the IP; 50 for one email across all IPs lock
// the email. Locking an email on a handful of failures from anywhere would let
// anyone lock a real admin out; the high email-wide cap only stops spread-out
// guessing (admin passwords are 12+ characters).

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL_IP = 5;
const MAX_FAILURES_PER_IP = 20;
const MAX_FAILURES_PER_EMAIL = 50;

const failures = new Map<string, number[]>();
// Set when the failure map is full of active locks: every sign-in is refused
// until enough of them expire. Reaching it takes tens of thousands of failed
// sign-ins inside one window.
let saturated = false;

const isLockKey = (key: string, count: number) =>
  count >= (key.startsWith('pair:') ? MAX_FAILURES_PER_EMAIL_IP : key.startsWith('ip:') ? MAX_FAILURES_PER_IP : MAX_FAILURES_PER_EMAIL);

const emailKey = (email: string) => `email:${email.trim().toLowerCase()}`;
const pairKey = (email: string, ip: string) => `pair:${email.trim().toLowerCase()}|${ip}`;
const ipKey = (ip: string) => `ip:${ip}`;

function lockFor(key: string, max: number): number {
  const list = recentIn(failures, key, WINDOW_MS);
  if (list.length < max) return 0;
  return WINDOW_MS - (Date.now() - list[list.length - max]);
}

export function isLockedOut(email: string, ip: string): { locked: boolean; retryInMinutes: number } {
  if (saturated) {
    saturated = !prune(failures, WINDOW_MS, isLockKey);
    if (saturated) return { locked: true, retryInMinutes: Math.ceil(WINDOW_MS / 60000) };
  }
  const retryMs = Math.max(
    lockFor(pairKey(email, ip), MAX_FAILURES_PER_EMAIL_IP),
    lockFor(ipKey(ip), MAX_FAILURES_PER_IP),
    lockFor(emailKey(email), MAX_FAILURES_PER_EMAIL),
  );
  if (retryMs <= 0) return { locked: false, retryInMinutes: 0 };
  return { locked: true, retryInMinutes: Math.max(1, Math.ceil(retryMs / 60000)) };
}

export function recordFailure(email: string, ip: string) {
  const now = Date.now();
  for (const key of [pairKey(email, ip), emailKey(email), ipKey(ip)]) {
    const list = recentIn(failures, key, WINDOW_MS);
    list.push(now);
    failures.set(key, list);
  }
  saturated = !prune(failures, WINDOW_MS, isLockKey);
}

/** A good sign-in clears the email's counts; the IP's count stays. */
export function clearFailures(email: string, ip?: string) {
  failures.delete(emailKey(email));
  if (ip) failures.delete(pairKey(email, ip));
}

// ---- Per-user action limit -------------------------------------------------

const actions = new Map<string, number[]>();

/**
 * Counts one use of `action` by `userKey`. Returns false once the user has
 * used it `max` times within `windowMs` (default 20 a minute).
 */
export function allowAction(action: string, userKey: string, max = 20, windowMs = 60_000): boolean {
  const key = `${action}:${userKey.toLowerCase()}`;
  const list = recentIn(actions, key, windowMs);
  if (list.length >= max) return false;
  list.push(Date.now());
  actions.set(key, list);
  prune(actions, windowMs);
  return true;
}
