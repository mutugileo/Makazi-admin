// In-memory throttles, per server instance. Enough to slow guessing and
// runaway clicks; Supabase Auth rate-limits sign-ins on its side as well.

const MAX_KEYS = 10_000;

/** Drops expired keys; if still over the cap, drops the oldest ones. */
function prune(map: Map<string, number[]>, windowMs: number) {
  if (map.size <= MAX_KEYS) return;
  const now = Date.now();
  for (const [key, list] of map) {
    if (list.length === 0 || now - list[list.length - 1] >= windowMs) map.delete(key);
  }
  // Map iterates in insertion order, so the first keys are the oldest.
  for (const key of map.keys()) {
    if (map.size <= MAX_KEYS) break;
    map.delete(key);
  }
}

function recentIn(map: Map<string, number[]>, key: string, windowMs: number): number[] {
  const now = Date.now();
  const list = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length === 0) map.delete(key);
  else map.set(key, list);
  return list;
}

// ---- Sign-in lockout -------------------------------------------------------
// 5 failed sign-ins for one email (from any IP) or 20 from one IP (any email)
// within 15 minutes lock that email or IP out for the rest of the window.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 20;

const failures = new Map<string, number[]>();

const emailKey = (email: string) => `email:${email.trim().toLowerCase()}`;
const ipKey = (ip: string) => `ip:${ip}`;

function lockFor(key: string, max: number): number {
  const list = recentIn(failures, key, WINDOW_MS);
  if (list.length < max) return 0;
  return WINDOW_MS - (Date.now() - list[list.length - max]);
}

export function isLockedOut(email: string, ip: string): { locked: boolean; retryInMinutes: number } {
  const retryMs = Math.max(lockFor(emailKey(email), MAX_FAILURES_PER_EMAIL), lockFor(ipKey(ip), MAX_FAILURES_PER_IP));
  if (retryMs <= 0) return { locked: false, retryInMinutes: 0 };
  return { locked: true, retryInMinutes: Math.max(1, Math.ceil(retryMs / 60000)) };
}

export function recordFailure(email: string, ip: string) {
  const now = Date.now();
  for (const key of [emailKey(email), ipKey(ip)]) {
    const list = recentIn(failures, key, WINDOW_MS);
    list.push(now);
    failures.set(key, list);
  }
  prune(failures, WINDOW_MS);
}

/** A good sign-in clears the email's count; the IP's count stays. */
export function clearFailures(email: string) {
  failures.delete(emailKey(email));
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
