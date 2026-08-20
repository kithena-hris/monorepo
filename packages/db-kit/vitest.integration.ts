import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real Postgres, started per file by Testcontainers.
 *
 * These live here rather than in a service because this is where the code they
 * exercise lives. Row-level security and the transactional outbox are the two
 * mechanisms the whole architecture rests on — tenant isolation enforced by the
 * database rather than by remembering a WHERE clause, and a write and its event
 * committing together — and neither can be tested against a mock. A mocked
 * Postgres hides exactly the failures that matter: a policy that does not
 * apply, a transaction boundary that does not hold, a setting that leaks to the
 * next request on a pooled connection.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // Pulling and starting postgres:17-alpine on a cold CI runner is slower
    // than any unit test has a right to be.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One container per file, and files run in sequence. Parallel files would
    // start a container each and race the Docker daemon for no benefit at this
    // size.
    fileParallelism: false,
  },
});
