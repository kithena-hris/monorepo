import type { Decorator, Preview } from '@storybook/react-native-web-vite';
import { ReachProvider } from '@reach/ui-native';
import { View } from 'react-native-css/components';

import '@reach/ui-native/global.css';

/**
 * Every story on one phone, 390×844, in the theme the toolbar picks.
 *
 * `ReachProvider` is what an app puts at its root, so a story renders under
 * exactly what ships: the `dark` class re-pointing `--reach-color-*`, the safe
 * area, the gesture root and the portal host overlays open into.
 */
const withPhone: Decorator = (Story, context) => (
  <ReachProvider theme={context.globals['theme'] === 'dark' ? 'dark' : 'light'}>
    <View className="bg-canvas" style={{ width: 390, minHeight: 844 }}>
      {/* The design's phone frame pads 20 × 16; `reach-mobile:compare` shoots this view. */}
      <View testID="reach-story" className="px-m-margin py-5">
        <Story />
      </View>
    </View>
  </ReachProvider>
);

const preview: Preview = {
  decorators: [withPhone],
  globalTypes: {
    theme: {
      description: 'Colour scheme.',
      toolbar: {
        title: 'Theme',
        icon: 'contrast',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    options: { storySort: { order: ['Foundations', 'Components'] } },
  },
};

export default preview;
