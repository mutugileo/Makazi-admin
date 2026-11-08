/** A readable message from an Error or a Supabase/PostgREST error object. */
export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message || fallback || 'An unknown error occurred';
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message || fallback || 'An unknown error occurred';
  return fallback || String(err);
}
