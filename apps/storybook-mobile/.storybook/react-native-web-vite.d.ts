// The framework's own Vite plugins, which its package exports without types:
// what `vitest.config.ts`'s device project builds with.
declare module '@storybook/react-native-web-vite/vite-plugin' {
  import type { PluginOption } from 'vite';

  export function storybookReactNativeWeb(): PluginOption[];
}
