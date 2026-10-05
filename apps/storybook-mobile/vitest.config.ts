import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Every story as a test in Chromium at the one size this Storybook knows, a
 * 390×844 phone with a finger, with axe over each. Same gate as the web
 * Storybook's `storybook-phone` project.
 */
export default defineConfig({
  plugins: [storybookTest({ configDir: join(here, '.storybook') })],
  test: {
    name: 'storybook-mobile',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        contextOptions: { isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
      }),
      viewport: { width: 390, height: 844 },
      api: { host: '127.0.0.1' },
      instances: [{ browser: 'chromium' }],
    },
    setupFiles: ['./.storybook/vitest.setup.ts'],
  },
});
