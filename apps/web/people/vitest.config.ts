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
 * the keyboard up. `desk` renders the `*.browser.test` files again at desk
 * sizes with a mouse, and `desk-webkit` renders them in WebKit too. All three
 * are what `just test-stories` runs, beside Reach's own stories.
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
          exclude: ['src/**/*.{phone,browser}.test.{ts,tsx}'],
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
          include: ['src/**/*.{phone,browser}.test.{ts,tsx}'],
          setupFiles: ['./src/test/phone-setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            // A phone: its width, its height, and a finger for a pointer, so
            // `(pointer: coarse)` matches and Reach re-points its control sizes.
            // The page the runner draws the test in is the phone's size too:
            // at Playwright's default 1280×720 it scaled the 844-tall frame
            // down to fit, so a touch sent through CDP landed 17% off where
            // the test aimed it, and on Linux never scrolled what it was over.
            provider: playwright({
              contextOptions: {
                isMobile: true,
                hasTouch: true,
                deviceScaleFactor: 3,
                viewport: { width: 390, height: 844 },
              },
            }),
            viewport: { width: 390, height: 844 },
            // One IPv4 address for the port check, the bind and the URL the
            // browser loads; see apps/storybook/vitest.config.ts.
            api: { host: '127.0.0.1' },
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        extends: true,
        cacheDir: 'node_modules/.vite/desk',
        plugins: [tailwindcss()],
        test: {
          // The same real stylesheet with a mouse: what a phone's finger
          // cannot say about a desk, such as a table that swallows the wheel.
          name: 'desk',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          setupFiles: ['./src/test/phone-setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            // Big enough for the largest desk the tests use, so the frame is never scaled.
            provider: playwright({ contextOptions: { viewport: { width: 1440, height: 900 } } }),
            viewport: { width: 1280, height: 800 },
            api: { host: '127.0.0.1' },
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        extends: true,
        cacheDir: 'node_modules/.vite/desk-webkit',
        plugins: [tailwindcss()],
        test: {
          // The desk again in WebKit, Safari's engine: it lays out and clamps
          // a scroll box differently from Chromium, and a list that kept its
          // place in one lost it in the other.
          name: 'desk-webkit',
          // Not the import flow's: it scrolls through Chromium's own protocol (CDP).
          include: ['src/**/*.browser.test.{ts,tsx}'],
          exclude: ['src/import/import-flow.browser.test.tsx'],
          setupFiles: ['./src/test/phone-setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ contextOptions: { viewport: { width: 1440, height: 900 } } }),
            viewport: { width: 1280, height: 800 },
            api: { host: '127.0.0.1' },
            instances: [{ browser: 'webkit' }],
          },
        },
      },
    ],
  },
});
