// Slows down password guessing: 5 failed sign-ins per email+IP within 15
// minutes locks that pair out for the rest of the window. In-memory, which is
// enough for one local server; Supabase Auth rate-limits in Phase 2.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

const failures = new Map<string, number[]>();

function recent(key: string): number[] {
  const now = Date.now();
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, list);
  return list;
}

export function isLockedOut(key: string): { locked: boolean; retryInMinutes: number } {
  const list = recent(key);
  if (list.length < MAX_FAILURES) return { locked: false, retryInMinutes: 0 };
  const retryMs = WINDOW_MS - (Date.now() - list[0]);
  return { locked: true, retryInMinutes: Math.max(1, Math.ceil(retryMs / 60000)) };
}

export function recordFailure(key: string) {
  recent(key).push(Date.now());
}

export function clearFailures(key: string) {
  failures.delete(key);
}
