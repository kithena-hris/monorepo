import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real Postgres, started per file by Testcontainers.
 *
 * The session cap is the reason this config exists. It is half a domain rule
 * and half a unique index, and the half that matters under load cannot be
 * tested without a database that will actually refuse the second insert.
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
