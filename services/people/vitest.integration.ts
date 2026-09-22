import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real Postgres, started per file by Testcontainers.
 *
 * Tenant isolation is the reason this config exists. It is a database property
 * rather than an application one — `svc_people` is `NOBYPASSRLS` and every
 * table carries a FORCE policy — and neither half can be tested against a
 * fake. A role that quietly carries BYPASSRLS passes every unit test ever
 * written and reads every customer's employee records in production.
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
