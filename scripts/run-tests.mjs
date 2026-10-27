// Unit tests for pure modules (no Astro runtime): bundles each *.test.ts with
// esbuild, which Astro already installs, and runs them with node:test.
import { build } from 'esbuild';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const tests = readdirSync('src', { recursive: true })
  .filter((f) => String(f).endsWith('.test.ts'))
  .map((f) => join('src', String(f)));
const outdir = mkdtempSync(join(tmpdir(), 'makazi-tests-'));
try {
  await build({ entryPoints: tests, bundle: true, platform: 'node', format: 'esm', outdir, outbase: 'src', outExtension: { '.js': '.mjs' }, logLevel: 'warning' });
  const files = readdirSync(outdir, { recursive: true }).filter((f) => String(f).endsWith('.mjs')).map((f) => join(outdir, String(f)));
  const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
