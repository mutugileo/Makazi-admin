/**
 * A message safe to show a landlord. Errors the database raises on purpose
 * (errcode 22023 or a plain RAISE, P0001) are written for people and pass
 * through; other database errors are mapped by code and logged on the server,
 * so a constraint name or SQL detail never reaches the screen.
 */
export function errorMessage(err: unknown, fallback = "Couldn't save. Try again."): string {
  if (err instanceof Error) return err.message || fallback;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
    if (code === '22023' || code === 'P0001') return err.message || fallback;
    console.error('[db error]', code, err.message);
    if (code === '23505') return 'That already exists. Check for a duplicate.';
    if (code === '23503') return "That record is linked to something else and can't be changed.";
    if (code === '23514') return "That value isn't allowed. Check the details and try again.";
    if (code === '42501') return "You don't have access to that.";
    return fallback;
  }
  return fallback;
}
