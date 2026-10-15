import { defineConfig } from 'vitest/config';

/** Kithena Jobs' pure helpers and client pieces, in jsdom. apps/admin's shape. */
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 15_000,
  },
});
