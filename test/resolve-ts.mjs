// Test-only resolve hook: src/lib imports omit the '.ts' extension (Vite
// resolves them for Astro), but node's type stripping needs the real file.
// Retries an unresolved relative specifier with '.ts', then '/index.ts'.
// astro:* virtual modules only exist inside Astro's build, so a test that
// pulls one in fails with a clear message instead of a resolver stack.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('astro:')) {
      throw new Error(
        `'${specifier}' is an Astro virtual module and can't load under node --test. Test only modules that don't import astro:*.`,
      );
    }
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !relative || specifier.endsWith('.ts')) throw err;
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // try the next form
        }
      }
      throw err;
    }
  },
});
