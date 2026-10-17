import { defineConfig } from 'vitest/config';

/**
 * Contract tests. No infrastructure and no siblings: these compare this
 * module's manifest against `@kithena/contracts`, which is the only vocabulary a
 * module shares with the rest of the system.
 *
 * The point is the seam. A module that renames an event it publishes breaks
 * every consumer, and the consumer is in a different deployment that will not
 * be rebuilt — so the disagreement has to surface here, against the shared
 * registry, rather than in production against a topic that no longer exists.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.contract.test.ts'],
  },
});
