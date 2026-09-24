import { federation } from '@module-federation/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/*
 * One copy of React and of Reach on the page, and it is the shell's.
 *
 * `import: false` means this build carries no fallback copy of either: the
 * remote runs against what the host put in the share scope, or fails loudly
 * when loaded somewhere that provides none. A fallback would be worse than a
 * failure — two Reacts on a page break every hook, and two Reach copies split
 * every context (tooltips, theme) down the seam.
 *
 * `requiredVersion: false` because the host's React is the one Next vendors,
 * a canary build whose prerelease version no `^19` range accepts. The shell
 * is the authority on which React runs; the remote does not get a vote.
 *
 * `base: './'` so chunks resolve against `remoteEntry.js` rather than against
 * the shell's origin, and the remote can be served from anywhere without being
 * rebuilt for the address. `remoteEntry.js` keeps a stable name and the chunks
 * behind it are hashed, so the shell never learns a build hash: redeploying
 * the remote is replacing this directory.
 */
const hostOwned = { singleton: true, requiredVersion: false, import: false } as const;

export default defineConfig({
  base: './',
  plugins: [
    react(),
    // This remote's own utilities, compiled and shipped with it. `src/styles.css`.
    tailwindcss(),
    federation({
      name: 'people',
      filename: 'remoteEntry.js',
      exposes: { '.': './src/index.ts' },
      shared: {
        react: hostOwned,
        'react/jsx-runtime': hostOwned,
        '@reach/ui': hostOwned,
      },
      dts: false,
      manifest: false,
      // Inject the remote's stylesheet when the expose loads, and wait for it,
      // so a screen never paints before its own utilities arrive.
      bundleAllCSS: true,
    }),
  ],
  build: { target: 'es2022', rolldownOptions: { input: {} } },
});
