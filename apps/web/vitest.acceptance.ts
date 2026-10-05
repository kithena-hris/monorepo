import { defineConfig } from 'vitest/config';

/**
 * The acceptance suite: the shell, the People and Time Off remotes and their
 * services running for real, driven by a browser (`acceptance/stack.ts`).
 *
 * Not in `pnpm test`: it builds three apps and starts containers, which takes
 * minutes. `pnpm --filter @kithena/web test:acceptance` runs it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['acceptance/**/*.acceptance.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 900_000,
    // The builds, once for every file (`acceptance/build.ts`).
    globalSetup: ['acceptance/build.ts'],
    fileParallelism: false,
  },
});
