import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real Postgres, started per file by Testcontainers.
 *
 * The delivery log is why this config exists. Its two load-bearing properties
 * are the database's rather than the code's — a row-level security policy that
 * actually isolates, and a SECURITY DEFINER function that actually sees past it
 * — and neither can be tested against a fake, which would only agree with
 * whatever the code did.
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
