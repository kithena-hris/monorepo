import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The screens, rendered in jsdom and run through axe.
 *
 * Not Storybook: Reach's Storybook is the design system's public
 * documentation and must not learn this product exists. These tests do the
 * same two jobs for the screens here — render every state, and fail on an
 * accessibility violation — without publishing a screen anywhere.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    /*
     * Longer than vitest's 5s default because of the first test in each file,
     * not the tests. That one pays a fresh worker's one-off costs: React, Radix
     * and axe all run cold, and axe builds its rule caches on its first call.
     * On a busy runner that alone took 3.1s in CI and up to 6.9s here under
     * sixteen suites at once, while every later test in the same files stayed
     * under 1s. Anything genuinely hanging still fails, at 15s.
     */
    testTimeout: 15_000,
  },
});
