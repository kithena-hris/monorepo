import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-native-web-vite';

const config: StorybookConfig = {
  // Relative to this directory: the Vitest integration resolves globs against
  // `configDir`, as in the web Storybook.
  stories: ['../../../packages/ui-native/src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
  framework: {
    name: '@storybook/react-native-web-vite',
    options: {
      // Reanimated 4's worklets need their Babel plugin on the web too.
      pluginReactOptions: { babel: { plugins: ['react-native-worklets/plugin'] } },
    },
  },
  // One device. The viewport is fixed in `preview.tsx`, not chosen from a toolbar.
  features: { viewport: false, backgrounds: false, measure: false, outline: false },
  core: { disableTelemetry: true },
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
      ],
    },
  }),
};

export default config;
