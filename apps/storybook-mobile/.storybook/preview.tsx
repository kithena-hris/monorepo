import { DocsContainer } from '@storybook/addon-docs/blocks';
import type { Decorator, Preview } from '@storybook/react-native-web-vite';
import { ReachProvider } from '@reach/ui-native';
import { useSyncExternalStore, type ReactNode } from 'react';
import { View } from 'react-native-css/components';
import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events';
import { addons } from 'storybook/preview-api';

import { DEVICES, Device, SystemChrome, platformOf, underTest } from './device';
import { darkDocsTheme, lightDocsTheme } from './manager-theme';

import '@reach/ui-native/global.css';
import './preview.css';

/**
 * The theme on `<html>`, written from the channel the moment the global
 * changes, as the web Storybook does: a decorator runs only when a story
 * renders, so a docs page (and Welcome) would otherwise keep whatever class
 * the last story left. Seeded from the document, which the inline script in
 * `main.ts` set before anything painted.
 */
let appliedTheme: 'light' | 'dark' = document.documentElement.classList.contains('dark')
  ? 'dark'
  : 'light';
const themeListeners = new Set<() => void>();

const applyThemeClass = (payload: { globals?: Record<string, unknown> }): void => {
  const next = payload.globals?.['theme'] === 'dark' ? 'dark' : 'light';
  if (next === appliedTheme) return;
  appliedTheme = next;
  document.documentElement.classList.toggle('dark', next === 'dark');
  document.documentElement.style.colorScheme = next;
  for (const listener of themeListeners) listener();
};

const channel = addons.getChannel();
channel.on(SET_GLOBALS, applyThemeClass);
channel.on(GLOBALS_UPDATED, applyThemeClass);

const subscribeToTheme = (listener: () => void): (() => void) => {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
};
const readTheme = (): 'light' | 'dark' => appliedTheme;

/** The docs canvas, themed from the same snapshot as the manager. */
function ReachDocsContainer({
  children,
  ...props
}: { children?: ReactNode } & Record<string, unknown>): React.JSX.Element {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, () => 'light' as const);
  return (
    // @ts-expect-error `DocsContainer` requires the docs `context`, which
    // Storybook passes through at runtime and does not type on this boundary.
    <DocsContainer {...props} theme={theme === 'dark' ? darkDocsTheme : lightDocsTheme}>
      {children}
    </DocsContainer>
  );
}

/**
 * Every story on its platform's phone, under `ReachProvider`, which is what an
 * app puts at its root: the `dark` class, the platform, the safe area, the
 * gesture root and the portal host overlays open into. On the canvas the
 * provider fills the phone's screen (`Device`), so a long story scrolls inside
 * it and an overlay covers the screen, with the platform's status bar and home
 * indicator around it. On a docs page each story takes only the height it
 * needs, at the phone's width or the page's, whichever is narrower.
 */
const withPhone: Decorator = (Story, context) => {
  const platform = platformOf(context.title);
  const story = (
    // The design's phone frame pads 20 × 16; `reach-mobile:compare` shoots this view.
    <View testID="reach-story" className="px-m-margin py-5" style={{ flexGrow: 1, flexShrink: 0 }}>
      <Story />
    </View>
  );
  const provider = (body: ReactNode): React.JSX.Element => (
    <ReachProvider
      theme={context.globals['theme'] === 'dark' ? 'dark' : 'light'}
      platform={platform}
    >
      {body}
    </ReachProvider>
  );
  if (underTest) return provider(<View className="flex-1 bg-canvas">{story}</View>);
  if (context.viewMode === 'docs') {
    return provider(
      <View className="bg-canvas" style={{ width: DEVICES[platform].width, maxWidth: '100%' }}>
        {story}
      </View>,
    );
  }
  return (
    <Device platform={platform}>
      {provider(<SystemChrome platform={platform}>{story}</SystemChrome>)}
    </Device>
  );
};

const preview: Preview = {
  decorators: [withPhone],
  globalTypes: {
    theme: {
      description: 'Colour scheme. Writes the `dark` class, as an app does.',
      // No `toolbar`: the control is the one-press toggle in `manager.tsx`.
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    docs: { toc: true, container: ReachDocsContainer },
    options: {
      storySort: {
        // The same tree under each platform's section (`device.tsx`'s PLATFORMS).
        // Literal: Storybook reads this statically, so nothing here may be computed.
        order: [
          'Welcome',
          'iOS',
          [
            'Foundations',
            [
              'Tokens',
              'Motion',
              'Typography',
              'Icons',
              'App marks',
              'Brand',
              'Responsive',
              'Patterns',
            ],
            'Layouts',
            ['Presets', 'Hierarchical', 'Modal page'],
            'Forms',
            'Charts',
            'Components',
            '*',
          ],
          'Android',
          [
            'Foundations',
            [
              'Tokens',
              'Motion',
              'Typography',
              'Icons',
              'App marks',
              'Brand',
              'Responsive',
              'Patterns',
            ],
            'Layouts',
            ['Presets', 'Hierarchical', 'Modal page'],
            'Forms',
            'Charts',
            'Components',
            '*',
          ],
        ],
      },
    },
  },
  tags: ['autodocs'],
};

export default preview;
