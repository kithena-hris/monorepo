import { defineConfig } from 'vitest/config';

/**
 * Node environment, not jsdom. What is tested here is hostname parsing and
 * tenant resolution, which runs in the proxy before any React does; a DOM would
 * be setup cost for something that never touches one.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
