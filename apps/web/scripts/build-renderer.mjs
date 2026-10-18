import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

/*
 * `src/lib/remote-renderer.ts` as one file the renderer process can read and
 * nothing else (PEO-115): React, its DOM server and the design system inside
 * it, so the permission model can allow exactly one path.
 *
 * React is the copy Next renders the App Router with (`next/dist/compiled`),
 * not the one in `node_modules`: the markup the browser hydrates has to come
 * from the same React the browser runs, down to the format of an `id`.
 *
 * Run before `next build` and `next dev`. Its output is `.renderer/`, ignored
 * by git and traced into the server's bundle by `next.config.mjs`.
 */
const app = join(import.meta.dirname, '..');
const next = dirname(createRequire(join(app, 'package.json')).resolve('next/package.json'));
const compiled = (name) => join(next, 'dist/compiled', name);

await build({
  entryPoints: [join(app, 'src/lib/remote-renderer.ts')],
  outfile: join(app, '.renderer/renderer.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  jsx: 'automatic',
  minify: false,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    react: compiled('react'),
    'react-dom': compiled('react-dom'),
  },
});

/*
 * The one Module Federation runtime every remote and the shell share
 * (`src/lib/mf-runtime.ts`): ES modules under `public/_mf/<version>/`, one per
 * name the import map gives, split so they share a single runtime core. The
 * version is the pin in `package.json` and must be the one installed.
 */
const require = createRequire(join(app, 'package.json'));
const pinned = JSON.parse(await readFile(join(app, 'package.json'), 'utf8')).dependencies[
  '@module-federation/runtime'
];
const named = /MF_RUNTIME_VERSION = '([^']+)'/u.exec(
  await readFile(join(app, 'src/lib/mf-runtime.ts'), 'utf8'),
)?.[1];
// The installed package's own version: its directory, up from the entry it resolves to.
let installed = dirname(require.resolve('@module-federation/runtime'));
while (!existsSync(join(installed, 'package.json'))) installed = dirname(installed);
const { version } = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
if (pinned !== version || named !== version)
  throw new Error(
    `@module-federation/runtime: pinned ${String(pinned)}, installed ${String(version)}, src/lib/mf-runtime.ts ${String(named)}; make all three one version`,
  );

await build({
  entryPoints: {
    runtime: '@module-federation/runtime',
    helpers: '@module-federation/runtime/helpers',
  },
  outdir: join(app, 'public/_mf', version),
  entryNames: '[name]',
  chunkNames: 'core-[hash]',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});
