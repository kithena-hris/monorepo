import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

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
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['./.storybook/vitest.setup.ts'],
        },
      },
      {
        extends: true,
        // Its own dependency cache. The two projects' configs differ, so on a
        // shared cache each re-optimises the other's dependencies mid-run and
        // the browser's in-flight imports of the old chunks fail.
        cacheDir: join(here, 'node_modules/.vite/phone'),
        test: {
          name: 'storybook-phone',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              contextOptions: { isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
            }),
            viewport: { width: 390, height: 844 },
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['./.storybook/vitest.setup.ts', './.storybook/tap-floor.ts'],
        },
      },
    ],
  },
});
