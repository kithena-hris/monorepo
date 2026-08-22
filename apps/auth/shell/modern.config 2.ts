import { appTools, defineConfig } from '@modern-js/app-tools';

/**
 * The auth origin.
 *
 * Modern.js rather than Next, for the reason recorded in
 * `docs/authentication.md`: `@module-federation/nextjs-mf` is deprecated and
 * never supported App Router, and the Module Federation team maintains this
 * framework instead.
 *
 * This app is deliberately **not** a federation host. Auth is six screens with
 * no shared state and nobody blocked on it, and it is on its own origin
 * already, which is what independent deployment actually needs here. The folder
 * has room for remotes so that splitting later is a move rather than a
 * restructure — see `docs/code-structure.md`.
 */
export default defineConfig({
  source: {
    // `@reach/ui` ships TypeScript source rather than build output, so the
    // consumer compiles it. Next does this through `transpilePackages`; here it
    // is an include path. One compiler, one set of settings, and no
    // watch-and-rebuild step between editing a component and seeing it.
    include: [/[\\/]node_modules[\\/]@reach[\\/]ui[\\/]/],
  },
  server: {
    // Streaming SSR. Modern.js only supports Module Federation alongside
    // streaming, and it is the mode that matters anyway: the login screen has
    // to paint on the low-end hardware the deskless case depends on.
    ssr: { mode: 'stream' },
    port: 3100,
  },
  // No options: `appTools()` takes none in 3.8, and Rspack is the bundler
  // either way — which is the point of being on this framework at all, since
  // Rspack and Module Federation are maintained by the same team.
  plugins: [appTools()],
});
