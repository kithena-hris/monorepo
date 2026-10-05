import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-native-web-vite';

// The web Storybook's favicon: one mark, one file.
const reachFavicon = readFileSync(
  fileURLToPath(new URL('../../storybook/.storybook/favicon.svg', import.meta.url)),
  'utf8',
);

const config: StorybookConfig = {
  // Relative to this directory: the Vitest integration resolves globs against
  // `configDir`, as in the web Storybook.
  stories: [
    './welcome.mdx',
    '../../../packages/ui-native/src/**/*.stories.@(ts|tsx)',
    // A deliberately broken story proving axe fails the suite. Tests only:
    // Vitest sets `VITEST`, a build and `storybook dev` do not.
    ...(process.env['VITEST'] ? ['./a11y-gate.stories.tsx'] : []),
  ],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
  framework: {
    name: '@storybook/react-native-web-vite',
    options: {
      // Reanimated 4's worklets need their Babel plugin on the web too.
      pluginReactOptions: { babel: { plugins: ['react-native-worklets/plugin'] } },
    },
  },
  // `react-docgen`, as the web: `react-docgen-typescript` loads the TypeScript
  // compiler's internal API, which TypeScript 7 no longer exposes.
  typescript: { reactDocgen: 'react-docgen' },
  docs: { defaultName: 'Overview' },
  // One device. The phone is fixed in `preview.tsx`, never chosen from a toolbar.
  features: { viewport: false, backgrounds: false, measure: false, outline: false },
  core: { disableTelemetry: true },

  // The favicon here; the title and the sidebar brand live in `manager.tsx`.
  managerHead: (head) =>
    `${head ?? ''}<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(reachFavicon)}">`,

  /**
   * The theme before the first paint, as the web Storybook does it: an inline,
   * blocking script reads the theme from the iframe's own URL (where Storybook
   * puts the globals) and sets the `dark` class and `color-scheme` on `<html>`,
   * so a dark story never flashes white while JavaScript loads.
   */
  previewHead: (head) =>
    `${head ?? ''}<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(reachFavicon)}">` +
    `<script>(function(){try{` +
    `var g=new URLSearchParams(location.search).get('globals')||'';` +
    `var m=/(?:^|;)theme:([^;]*)/.exec(g);` +
    `var dark=m?m[1]==='dark':false;` +
    `if(dark){document.documentElement.classList.add('dark');}` +
    `document.documentElement.style.colorScheme=dark?'dark':'light';` +
    `}catch(e){}})();</script>`,

  viteFinal: (vite) => ({
    ...vite,
    plugins: [...(vite.plugins ?? []), tailwindcss()],
    resolve: {
      ...vite.resolve,
      // `@reach/ui-native` is a workspace link whose own devDependencies pin
      // the React Native app's React. Without this the canvas gets two Reacts.
      dedupe: [
        'react',
        'react-dom',
        'react-native-web',
        'react-native-css',
        'react-native-reanimated',
        'react-native-svg',
        'react-native-safe-area-context',
        'react-native-gesture-handler',
      ],
    },
  }),
};

export default config;
