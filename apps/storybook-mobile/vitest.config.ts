import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { storybookReactNativeWeb } from '@storybook/react-native-web-vite/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { transformWithOxc, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

/** A 390×844 phone with a finger, in Chromium. */
const browser = {
  enabled: true,
  headless: true,
  provider: playwright({
    contextOptions: { isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  }),
  viewport: { width: 390, height: 844 },
  api: { host: '127.0.0.1' },
  instances: [{ browser: 'chromium' as const }],
};

/**
 * `@rn-primitives`' native builds, which ship JSX for Metro to compile: here
 * for the device project, which runs them in place of the web builds.
 */
function nativePrimitives(): Plugin {
  const native = /\/@rn-primitives\/[^/]+\/dist\/[^/.]+\.mjs$/;
  return {
    name: 'reach:native-primitives',
    enforce: 'pre',
    async transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (!native.test(file)) return null;
      const out = await transformWithOxc(code, `${file}.jsx`, {
        lang: 'jsx',
        jsx: { runtime: 'automatic' },
      });
      return { code: out.code, ...(out.map ? { map: out.map } : {}) };
    },
  };
}

/**
 * Every story as a test in Chromium at the one size this Storybook knows, a
 * 390×844 phone with a finger, with axe over each. Same gate as the web
 * Storybook's `storybook-phone` project. Twice: once drawn for iOS and once
 * for Android, as the sidebar lists them (`.storybook/device.tsx`).
 */
export default defineConfig({
  plugins: [storybookTest({ configDir: join(here, '.storybook') })],
  test: {
    name: 'storybook-mobile',
    browser,
    setupFiles: ['./.storybook/vitest.setup.ts'],
    projects: [
      ...(['ios', 'android'] as const).map((platform) => ({
        extends: true as const,
        define: { __REACH_PLATFORM__: JSON.stringify(platform) },
        test: { name: `storybook-mobile (${platform})` },
      })),
      // Reach Mobile's overlays with `@rn-primitives`' native builds, as a
      // device draws them (`packages/ui-native/src/test/*.device-test.tsx`).
      // Not a Storybook project: its plugin lists stories and nothing else.
      {
        plugins: [nativePrimitives(), storybookReactNativeWeb(), tailwindcss()],
        resolve: {
          // One React, as the Storybook (`.storybook/main.ts`).
          dedupe: ['react', 'react-dom', 'react-native-web', 'react-native-css'],
        },
        test: {
          name: 'reach-mobile on a device',
          root: here,
          include: ['../../packages/ui-native/src/test/*.device-test.tsx'],
          browser,
        },
      },
    ],
  },
});
