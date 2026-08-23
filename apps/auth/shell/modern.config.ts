import { appTools, defineConfig } from '@modern-js/app-tools';

/**
 * The auth origin.
 *
 * Modern.js rather than Next, for the reason in `docs/authentication.md`:
 * `@module-federation/nextjs-mf` is deprecated and never supported App Router,
 * and the Module Federation team maintains this framework instead.
 *
 * This app is deliberately **not** a federation host. Auth is six screens with
 * no shared state and nobody blocked on it, and it is on its own origin
 * already, which is what independent deployment actually needs here.
 */
export default defineConfig({
  source: {
    // `@reach/ui` ships TypeScript source rather than build output, so the
    // consumer compiles it. Next does this through `transpilePackages`; here it
    // is an include path.
    include: [/[\\/]node_modules[\\/]@reach[\\/]ui[\\/]/],
  },
  server: {
    // The server compile needs to emit; the app's tsconfig sets `noEmit`.
    // See tsconfig.server.json for what that cost before it was noticed.
    tsconfigPath: './tsconfig.server.json',
    // Streaming SSR. Modern.js only supports Module Federation alongside
    // streaming, and it is the mode that matters anyway: the login screen has
    // to paint on the low-end hardware the deskless case depends on.
    ssr: { mode: 'stream' },
    port: 3100,
  },
  /*
   * No `tools.devServer.proxy`.
   *
   * Credential injection lives in `server/modern.server.ts`, which is the same
   * server under `modern dev` and in a build. The proxy it replaces existed
   * only in development, so a built auth origin had no way to reach identity —
   * and it passed the session id through to the browser on the way back, which
   * is the property an `HttpOnly` cookie exists to prevent.
   */
  plugins: [appTools()],
});
