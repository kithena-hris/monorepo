import { defineConfig } from 'vitest/config';

/**
 * The default suite: pure, fast, no infrastructure.
 *
 * The transports are ports with fakes and the rendering is a pure function over
 * a struct, so almost everything belongs here. `*.integration.test.ts` is
 * excluded because it needs Docker and minutes of timeout — running it by
 * accident turns a red default suite into noise that says nothing about the
 * code.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.integration.test.ts'],
  },
});
