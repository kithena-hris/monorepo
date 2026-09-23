import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * The screens, twice.
 *
 * `unit` renders every state in jsdom and runs axe over it — fast, and what
 * `just test` runs. `phone` renders them again in Chromium at 390×844 with a
 * coarse pointer and the real stylesheet, and measures what jsdom cannot: tap
 * targets against the 44px floor, and whether "Save" is still reachable with
 * the keyboard up. That is what `just test-stories` runs, beside Reach's own
 * stories.
 *
 * Not Storybook: Reach's Storybook is the design system's public
 * documentation and must not learn this product exists. These do the same two
 * jobs for the screens here without publishing a screen anywhere.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.phone.test.{ts,tsx}'],
          /*
           * Longer than vitest's 5s default because of the first test in each
           * file, not the tests. That one pays a fresh worker's one-off costs:
           * React, Radix and axe all run cold, and axe builds its rule caches
           * on its first call. On a busy runner that alone took 3.1s in CI and
           * up to 6.9s here under sixteen suites at once, while every later
           * test in the same files stayed under 1s. A genuine hang still
           * fails, at 15s.
           */
          testTimeout: 15_000,
        },
      },
      {
        extends: true,
        // Its own dependency cache, so the two projects do not re-optimise
        // each other's dependencies mid-run.
        cacheDir: 'node_modules/.vite/phone',
        plugins: [tailwindcss()],
        test: {
          name: 'phone',
          include: ['src/**/*.phone.test.{ts,tsx}'],
          setupFiles: ['./src/test/phone-setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            // A phone: its width, its height, and a finger for a pointer, so
            // `(pointer: coarse)` matches and Reach re-points its control sizes.
            provider: playwright({
              contextOptions: { isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
            }),
            viewport: { width: 390, height: 844 },
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
