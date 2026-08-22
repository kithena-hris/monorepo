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
   * this origin has to add it. The framework's own answer is `api/` handlers —
   * which do not work on 3.8: every server-framework plugin
   * (`plugin-express`, `plugin-koa`, `plugin-server`) is still published on the
   * 2.x line at 2.70.4, `plugin-bff` is on 3.8.2, and the older plugin reads an
   * `appContext.apiMode` the newer one no longer sets. The BFF fails at boot
   * with "mode must be function or framework".
   *
   * So the token is injected here instead. This is a development arrangement
   * and it has a real gap: a proxy passes the response through, so the session
   * id reaches the browser rather than becoming an `HttpOnly` cookie on the way.
   * Closing that needs a server route, which needs either a working BFF or a
   * custom server — see the note in docs/build-plan.md.
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
