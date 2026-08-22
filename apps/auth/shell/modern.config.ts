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
    // Streaming SSR. Modern.js only supports Module Federation alongside
    // streaming, and it is the mode that matters anyway: the login screen has
    // to paint on the low-end hardware the deskless case depends on.
    ssr: { mode: 'stream' },
    port: 3100,
  },
  /*
   * A proxy, not a BFF, and not by choice.
   *
   * The browser must not hold the credential identity requires, so something on
   * this origin has to add it. The framework's own answers both fail on 3.8.2,
   * and both were measured rather than assumed:
   *
   *   * `api/` handlers (BFF). Every server-framework plugin is still published
   *     on the 2.x line at 2.70.4 while `plugin-bff` is 3.8.2, and the older
   *     plugin reads an `appContext.apiMode` the newer one no longer sets. It
   *     fails at boot with "mode must be function or framework".
   *   * `server/modern.server.ts` (custom Web Server). Tried on 2026-08-22.
   *     `defineServerConfig` is accepted and the file loads without error, but
   *     a middleware registered exactly as the bundled docs show never runs — a
   *     probe that only sets a response header produced no header on any route.
   *     Separately, `import { type MiddlewareHandler }` with the inline type
   *     modifier panics Rspack outright: "should have connection". A minimal
   *     `defineServerConfig({})` builds and boots fine, so the feature is
   *     wired up and inert rather than absent.
   *
   * So the token is injected here. This is a development arrangement with two
   * known gaps, and neither is fixed:
   *
   *   * `tools.devServer` only runs under `modern dev`, so a built auth origin
   *     has no way to reach identity at all.
   *   * A proxy passes the response through, so the session id reaches the
   *     browser rather than becoming an `HttpOnly` cookie on the way.
   *
   * Closing them needs a server this framework version does not currently
   * provide. docs/build-plan.md carries the decision that is now owed.
   */
  tools: {
    devServer: {
      proxy: {
        '/api/identity': {
          target: process.env['INTERNAL_API_URL'] ?? 'http://localhost:4100',
          changeOrigin: false,
          headers: { 'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '' },
          pathRewrite: { '^/api/identity': '/api/internal' },
        },
      },
    },
  },
  plugins: [appTools()],
});
