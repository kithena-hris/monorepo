import { defineConfig } from 'vitest/config';

/**
 * The whole suite: pure, fast, no infrastructure. The assistant holds no
 * database, and its modules, identity and model are ports with fakes, so
 * nothing here needs Docker.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
