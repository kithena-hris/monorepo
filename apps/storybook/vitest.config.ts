import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Where each project's browser server listens, and so the origin Chromium
 * loads from. Left as `localhost`, Vite binds `[::1]` on the fixed ports
 * 63315/63316 but checks they are free only on the wildcard address, so a
 * process already holding `127.0.0.1` on one of them goes unnoticed and the
 * browser can end up talking to it. One explicit IPv4 address makes the port
 * Vite checks, the socket it binds and the URL it hands the browser the same.
 *
 * No `cacheDir` per project: `@storybook/addon-vitest` sets its own from its
 * `config` hook, which overrides this file, so both projects share
 * `node_modules/.cache/storybook/<version>/<hash>/sb-vitest/deps`. That is
 * safe: they optimise the same dependencies into byte-identical output. To see
 * the optimizer at work, run with `DEBUG=vite:deps`.
 */
const BROWSER_HOST = '127.0.0.1';

/**
 * Runs every story as a test in a real browser: it renders, its `play`
 * function runs, and axe checks the result. This is the accessibility gate —
 * a story that fails here fails CI, which is the only way an a11y rule stays
 * true six months after someone wrote it down.
 *
 * Twice. `storybook` is a desk: a mouse, a wide window. `storybook-phone` is
 * 390×844 with a finger, so `(pointer: coarse)` matches and every control
 * re-points to the tap floor; axe runs again there, and every tap target is
 * measured against 44px (`.storybook/tap-floor.ts`) rather than eyeballed.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), storybookTest({ configDir: join(here, '.storybook') })],
  // No alias for `@reach/ui`: the workspace link plus its `exports` map already
  // resolve both `@reach/ui` and `@reach/ui/styles.css`. Aliasing the bare
  // specifier to `index.ts` would send the stylesheet import to
  // `index.ts/styles.css`.
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            // Vitest 4 takes a provider factory here; the 3.x string form is gone.
            provider: playwright(),
            api: { host: BROWSER_HOST },
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['./.storybook/vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'storybook-phone',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              contextOptions: { isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
            }),
            viewport: { width: 390, height: 844 },
            api: { host: BROWSER_HOST },
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['./.storybook/vitest.setup.ts', './.storybook/tap-floor.ts'],
        },
      },
    ],
  },
});
