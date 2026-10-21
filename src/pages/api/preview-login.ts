import type { APIRoute } from 'astro';
import { createSession } from '../../lib/auth/session';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const companyId = url.searchParams.get('companyId') || 'harborridge';
  const name = companyId === 'harborridge' ? 'HarborRidge Admin' : 'Codzure Admin';
  const email = companyId === 'harborridge' ? 'harborridgelimited@gmail.com' : 'admin@codzure.local';

  createSession(
    cookies,
    {
      email,
      name,
      companyId,
      role: 'owner',
    },
    false
  );

  const next = url.searchParams.get('next') || '/';
  return redirect(next, 303);
};
