import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real Postgres, started per file by Testcontainers.
 *
 * One script needs one, and it is the one that matters: a migration this tool
 * emits has to be SQL Postgres actually accepts. Comparing the output to a
 * string typed twice in a unit test would assert that the template has not
 * changed, which is not the same claim at all.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
