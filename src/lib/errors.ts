/**
 * An error whose message is written for the landlord. Throw it from route
 * code when the message should reach the screen as is.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** Supabase Auth errors (AuthApiError, AuthRetryableFetchError, ...). */
function isAuthError(err: object): boolean {
  return ('__isAuthError' in err && err.__isAuthError === true) || (err instanceof Error && err.name.startsWith('Auth'));
}

/**
 * A message safe to show a landlord. Errors the database raises on purpose
 * (errcode 22023 or a plain RAISE, P0001) are written for people and pass
 * through; other database errors are mapped by code and logged on the server,
 * so a constraint name or SQL detail never reaches the screen. The code is read
 * first for any object, because postgrest-js errors are Error instances too.
 * Auth and network failures are logged and use the fallback; any other Error
 * our own code threw passes its message through.
 */
export function errorMessage(err: unknown, fallback = "Couldn't save. Try again."): string {
  if (err instanceof UserFacingError) return err.message || fallback;
  if (!err || typeof err !== 'object') return fallback;

  const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
  const message = 'message' in err && typeof err.message === 'string' ? err.message : '';
  // Not shaped like an error at all.
  if (!(err instanceof Error) && !('message' in err && typeof err.message === 'string')) return fallback;

  if (isAuthError(err)) {
    console.error('[auth error]', code, message);
    if (code === 'weak_password') return 'Choose a stronger password.';
    return fallback;
  }

  if (code) {
    if (code === '22023' || code === 'P0001') return message || fallback;
    console.error('[db error]', code, message);
    if (code === '23505') return 'That already exists. Check for a duplicate.';
    if (code === '23503') return "That record is linked to something else and can't be changed.";
    if (code === '23514') return "That value isn't allowed. Check the details and try again.";
    if (code === '42501') return "You don't have access to that.";
    return fallback;
  }

  if (err instanceof Error) {
    // fetch() failures ("TypeError: fetch failed") and aborts are not for people.
    if (err instanceof TypeError || err.name === 'AbortError') {
      console.error('[network error]', err.message);
      return fallback;
    }
    return err.message || fallback;
  }

  if (message) console.error('[db error]', message);
  return fallback;
}
