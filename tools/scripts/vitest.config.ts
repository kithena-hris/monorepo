import { defineConfig } from 'vitest/config';

/**
 * The default suite: fast, pure, no infrastructure.
 *
 * `*.integration.test.ts` is excluded because it starts Postgres through
 * Testcontainers, and `pnpm test` runs on a machine that may have no Docker —
 * which in CI is not a maybe. The `unit tests` job has none, so without this
 * exclusion `vitest run` picked the integration file up through its default
 * glob and failed there, while passing on a laptop with Docker running. That
 * is the worst shape a test failure can take: green where it was written, red
 * where it matters.
 *
 * Every other package in the repository carries the same split. This one was
 * added without it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.integration.test.ts'],
  },
});
