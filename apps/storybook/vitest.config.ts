import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Runs every story as a test in a real browser: it renders, its `play`
 * function runs, and axe checks the result. This is the accessibility gate —
 * a story that fails here fails CI, which is the only way an a11y rule stays
 * true six months after someone wrote it down.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), storybookTest({ configDir: join(here, '.storybook') })],
  // No alias for `@reach/ui`: the workspace link plus its `exports` map already
  // resolve both `@reach/ui` and `@reach/ui/styles.css`. Aliasing the bare
  // specifier to `index.ts` would send the stylesheet import to
  // `index.ts/styles.css`.
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      headless: true,
      // Vitest 4 takes a provider factory here; the 3.x string form is gone.
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
    setupFiles: ['./.storybook/vitest.setup.ts'],
  },
});
