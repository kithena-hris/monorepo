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
  target: 'node22',
  jsx: 'automatic',
  minify: false,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    react: compiled('react'),
    'react-dom': compiled('react-dom'),
  },
});
