import type { Decorator, Preview } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import '@reach/ui-native/global.css';

/**
 * Every story on one phone, 390×844, in the theme the toolbar picks.
 *
 * The theme is a `dark` class on an ancestor view, which is the same thing the
 * native app does: `tokens.css` re-points `--reach-color-*` under `.dark`, and
 * react-native-css on device and the browser here both honour it.
 */
const withPhone: Decorator = (Story, context) => (
  <View className={context.globals['theme'] === 'dark' ? 'dark' : ''}>
    <View className="bg-canvas p-4" style={{ width: 390, minHeight: 844 }}>
      <Story />
    </View>
  </View>
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
