import { defineConfig } from 'vitest/config';

/**
 * Node environment, not jsdom. What is tested here is hostname parsing and
 * tenant resolution, which runs in the proxy before any React does; a DOM would
 * be setup cost for something that never touches one. The one component test
 * (`workspace-asleep.test.tsx`) asks for jsdom itself, in its first line.
 */
export default defineConfig({
  // Next wants `"jsx": "preserve"` in tsconfig, and Vite 8's Oxc transform
  // honours it, leaving raw JSX for the import analyser to choke on when a
  // test imports a component module for its pure helpers. Compile it here.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
