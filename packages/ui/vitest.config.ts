import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Stories are exercised by the Storybook test runner, not here.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
