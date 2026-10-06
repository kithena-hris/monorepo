import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { transformAsync } from '@babel/core';
import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-native-web-vite';
import type { Plugin } from 'vite';

// The web Storybook's favicon: one mark, one file.
const reachFavicon = readFileSync(
  fileURLToPath(new URL('../../storybook/.storybook/favicon.svg', import.meta.url)),
  'utf8',
);

// `device.tsx`'s PLATFORMS, by section name; main.ts runs in Node and cannot
// import the preview's React Native code.
const PLATFORM_SECTIONS = ['iOS', 'Android'] as const;

/*
 * Third-party code that leaves its worklets to the worklets Babel plugin,
 * which Metro runs on a device. Vite would pre-bundle it untouched, and
 * React's plugin skips `node_modules`, so `workletLibraries` below runs the
 * plugin over it (the framework's `modulesToTranspile` cannot see through
 * pnpm's `.pnpm/` path, and hands the plugin a file name with Vite's query).
 */
const WORKLET_LIBRARIES = ['react-native-sortables'];

function workletLibraries(): Plugin {
  const match = new RegExp(`/node_modules/(${WORKLET_LIBRARIES.join('|')})/.*\\.js$`);
  return {
    name: 'reach:worklet-libraries',
    enforce: 'pre',
    async transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (!match.test(file)) return null;
      const out = await transformAsync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        plugins: ['react-native-worklets/plugin'],
      });
      return out?.code ? { code: out.code, map: out.map ?? null } : null;
    },
  };
}

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

  /**
   * Every story twice, under `iOS/` and `Android/`: the library's own stories
   * indexed as Storybook indexes them, then listed once per platform with the
   * section in front of the title. One file, one component, two entries; the
   * decorator in `preview.tsx` reads the section back and declares that
   * platform on `ReachProvider`. The deliberately broken gate story stays where
   * it is, outside both.
   */
  experimental_indexers: (existing) => {
    const csf = (existing ?? []).find((indexer) => indexer.test.test('a.stories.tsx'));
    if (!csf) throw new Error('No CSF indexer to list each story per platform.');
    return [
      {
        test: /packages\/ui-native\/src\/.*\.stories\.tsx?$/,
        createIndex: async (fileName, options) => {
          const entries = await csf.createIndex(fileName, options);
          return PLATFORM_SECTIONS.flatMap((section) =>
            entries.map(({ __id: _id, ...entry }) => ({
              ...entry,
              title: `${section}/${entry.title ?? options.makeTitle()}`,
            })),
          );
        },
      },
      ...(existing ?? []),
    ];
  },
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
    plugins: [...(vite.plugins ?? []), tailwindcss(), workletLibraries()],
    // Pre-bundling would skip the plugin those libraries need.
    optimizeDeps: {
      ...vite.optimizeDeps,
      exclude: [...(vite.optimizeDeps?.exclude ?? []), ...WORKLET_LIBRARIES],
    },
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
