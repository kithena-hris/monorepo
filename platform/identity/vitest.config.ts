import { defineConfig } from 'vitest/config';

/**
 * The default suite: pure, fast, no infrastructure.
 *
 * Identity has no standalone suite of its own, because `standalone` asks
 * whether a module boots without its siblings and identity has none. The
 * question it must answer instead is the mirror image — whether the *product*
 * boots without identity — and that is `just standalone-external`, which lives
 * with the thing being tested rather than here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.integration.test.ts'],
  },
});
