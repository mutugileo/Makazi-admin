import type { APIRoute } from 'astro';
import { clearSession } from '../lib/auth/session';

// POST only, so a link or image elsewhere can't sign someone out.
export const POST: APIRoute = ({ cookies, redirect }) => {
  clearSession(cookies);
  return redirect('/login', 303);
};
