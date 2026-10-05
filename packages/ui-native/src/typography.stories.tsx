import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { Text } from './text.tsx';

const meta = {
  title: 'Foundations/Typography',
  component: Text,
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

const SCALE = [
  ['large', 'Large title 700 34/41'],
  ['title1', 'Title 1 700 28/34'],
  ['title2', 'Title 2 700 22/28'],
  ['title3', 'Title 3 600 20/25'],
  ['headline', 'Headline 600 17/22'],
  ['body', 'Body 400 17/22'],
  ['callout', 'Callout 400 16/21'],
  ['subhead', 'Subhead 400 15/20'],
  ['footnote', 'Footnote 400 13/18'],
  ['caption', 'Caption 500 12/16'],
] as const;

function Scale(): React.JSX.Element {
  return (
    <View className="gap-2">
      {SCALE.map(([variant, label]) => (
        <Text key={variant} variant={variant}>
          {label}
        </Text>
      ))}
      <Text tone="muted">Muted body</Text>
    </View>
  );
}

export const TypeScale: Story = { render: () => <Scale /> };

export const TypeScaleDark: Story = { render: () => <Scale />, globals: { theme: 'dark' } };
