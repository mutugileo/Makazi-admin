// Supabase client factory for PropAdmin — Phase 2 data layer.
//
// Exports two helpers used by the rest of the codebase:
//   supabaseConfigured()  → true once both env vars are set in .env
//   makeSupabaseClient(cookies) → SupabaseClient scoped to the request's
//                                 session, or null in seed mode.
//
// The client uses @supabase/ssr so every server-side query inherits the
// signed-in user's JWT and Row-Level Security applies automatically.

import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';

// Read from astro:env or process.env
let _url: string | undefined;
let _key: string | undefined;

try {
  const env = await import('astro:env/server');
  const envMap = env as Record<string, string | undefined>;
  _url = envMap['SUPABASE_URL'] || envMap['PUBLIC_SUPABASE_URL'];
  _key = envMap['SUPABASE_SERVICE_ROLE_KEY'] || envMap['SUPABASE_ANON_KEY'] || envMap['PUBLIC_SUPABASE_ANON_KEY'];
} catch {
  // Not available (test / build contexts) — seed mode.
}

export function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || _url;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || _key || process.env.SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url: url.trim(), key: key.trim() };
}

/** True once SUPABASE_URL / PUBLIC_SUPABASE_URL and key are in .env. */
export function supabaseConfigured(): boolean {
  return Boolean(getSupabaseConfig());
}

/**
 * Creates a request-scoped Supabase client.
 * For PropAdmin server-side rendering, if a service role key is available,
 * it returns a trusted service client with auth: { persistSession: false }.
 * Otherwise it falls back to createServerClient forwarding cookies.
 */
export function makeSupabaseClient(cookies?: AstroCookies, request?: Request): SupabaseClient | null {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;

  const isServiceRole = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (_key && _key.length > 50 && !_key.startsWith('sb_publishable_'))
  );

  if (isServiceRole || !cookies) {
    return createClient(cfg.url, cfg.key, {
      auth: { persistSession: false },
    });
  }

  const raw = request?.headers?.get?.('cookie') ?? '';
  return createServerClient(cfg.url, cfg.key, {
    cookies: {
      getAll() {
        if (raw) {
          const parsed = parseCookieHeader(raw);
          return parsed.map(({ name, value }) => ({ name, value: value ?? '' }));
        }
        const all: Array<{ name: string; value: string }> = [];
        try {
          const projectRef = new URL(cfg.url).hostname.split('.')[0];
          const baseTokenName = `sb-${projectRef}-auth-token`;
          const mainCookie = cookies.get(baseTokenName);
          if (mainCookie?.value) {
            all.push({ name: baseTokenName, value: mainCookie.value });
          }
          for (let i = 0; i < 6; i++) {
            const chunk = cookies.get(`${baseTokenName}.${i}`);
            if (chunk?.value) {
              all.push({ name: `${baseTokenName}.${i}`, value: chunk.value });
            }
          }
          const verifier = cookies.get(`sb-${projectRef}-auth-token-code-verifier`);
          if (verifier?.value) {
            all.push({ name: `sb-${projectRef}-auth-token-code-verifier`, value: verifier.value });
          }
        } catch {
          // URL parse error
        }
        return all;
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookies.set(name, value, options as Parameters<AstroCookies['set']>[2]),
        );
      },
    },
  });
}

