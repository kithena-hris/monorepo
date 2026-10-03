import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real Postgres, started per file by Testcontainers.
 *
 * Tenant isolation is a database property — `svc_timeoff` is `NOBYPASSRLS`
 * and every table carries a FORCE policy — and neither half can be tested
 * against a fake.
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
