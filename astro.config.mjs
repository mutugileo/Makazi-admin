// @ts-check
import { defineConfig, envField } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  // Every page is rendered per request so middleware can check the session
  // before any tenant data leaves the server. Nothing is prebuilt to dist/.
  output: 'server',

  vite: {
    plugins: [tailwindcss()],
    // The billing seed lives in shared so the app can read it.
    server: { fs: { allow: ['..'] } }
  },

  adapter: vercel(),

  // Local admin account until Supabase Auth replaces it. Written to .env by
  // `npm run admin:create`; secrets never reach the browser.
  env: {
    schema: {
      ADMIN_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
      ADMIN_NAME: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Which landlord this local admin works for (a company id in the seed).
      ADMIN_COMPANY_ID: envField.string({ context: 'server', access: 'secret', optional: true, default: 'harborridge' }),
      ADMIN_PASSWORD_HASH: envField.string({ context: 'server', access: 'secret', optional: true }),
      SESSION_SECRET: envField.string({ context: 'server', access: 'secret', optional: true, min: 32 }),
      // Phase 2: Supabase project. Add these to .env when the project is ready.
      // The client factory in src/lib/supabase.ts returns null until both are set.
      SUPABASE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      SUPABASE_ANON_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      PUBLIC_SUPABASE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      PUBLIC_SUPABASE_ANON_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
    }
  }
});
