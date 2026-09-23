import { defineConfig } from 'vitest/config';

/**
 * The acceptance suite: the shell, the People remote and the People service
 * running for real, driven by a browser (`acceptance/stack.ts`).
 *
 * Not in `pnpm test`: it builds both apps and starts containers, which takes
 * minutes. `pnpm --filter @kithena/web test:acceptance` runs it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['acceptance/**/*.acceptance.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 900_000,
    fileParallelism: false,
  },
});
