import { defineConfig } from 'vitest/config';

/**
 * The default suite: fast, pure, no infrastructure and no special harness.
 *
 * The other three suites are excluded because each needs a config this one does
 * not have. `*.standalone.test.ts` only means anything with the sibling aliased
 * away, and picked up here it fails on a missing package rather than on the
 * guarantee it exists to check. `*.integration.test.ts` needs Docker and
 * minutes of timeout. Running them by accident turns a red default suite into
 * noise that says nothing about the code.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/**/*.standalone.test.ts',
      'src/**/*.contract.test.ts',
      'src/**/*.integration.test.ts',
    ],
  },
});
