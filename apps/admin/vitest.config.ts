import { defineConfig } from 'vitest/config';

/**
 * The back office's client components, in jsdom with axe over them. Same
 * shape as apps/web/people's `unit` project; the first test in a file pays
 * React, Radix and axe running cold, hence the longer timeout.
 */
export default defineConfig({
  // tsconfig says `preserve` for Next; the tests need the JSX compiled.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 15_000,
  },
});
