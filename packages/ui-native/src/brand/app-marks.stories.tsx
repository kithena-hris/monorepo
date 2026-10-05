import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { Button } from '../components/button/button.tsx';
import { Inline, Stack } from '../components/layout/layout.tsx';
import { Text } from '../components/text/text.tsx';
import { designDocs } from '../docs/design.ts';
import { ReachMark } from './reach-logo.tsx';

const meta = {
  title: 'Foundations/App marks',
  component: ReachMark,
  parameters: designDocs('app-marks'),
  args: { tile: true },
} satisfies Meta<typeof ReachMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Brand: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The accent tile, and its inverse for a surface where the accent would compete with what is around it. The corner is 9/32 of the side at every size.',
      },
    },
  },
  render: () => (
    <Inline gap={5}>
      <ReachMark tile size={96} title="Reach" />
      <ReachMark tile="invert" size={96} title="Reach, inverted" />
    </Inline>
  ),
};

const SIZES = [16, 20, 24, 32, 48, 64, 96];

export const Sizes: Story = {
  render: () => (
    <Inline gap={4} align="end" className="gap-x-[18px]">
      {SIZES.map((size) => (
        <Stack key={size} gap={2} align="center">
          <ReachMark tile size={size} />
          <Text variant="caption" tone="muted" mono>
            {String(size)}
          </Text>
        </Stack>
      ))}
    </Inline>
  ),
};

export const Mono: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'One colour, for print or a ground too busy for the accent. `tile="invert"` follows the theme; the bare glyph takes its tone.',
      },
    },
  },
  render: () => (
    <Inline gap={3}>
      <View className="rounded-lg bg-surface p-4 shadow-sm">
        <ReachMark tile="invert" size={56} title="Reach, one colour" />
      </View>
      <View className="rounded-lg bg-invert p-4">
        <ReachMark size={56} tone="on-invert" title="Reach, one colour reversed" />
      </View>
      <View className="rounded-lg bg-surface-sunken p-4">
        <ReachMark size={56} title="Reach, the glyph alone" />
      </View>
    </Inline>
  ),
};

export const InAButton: Story = {
  name: 'In a button',
  parameters: {
    docs: {
      description: {
        story:
          'Where a control hands the person over to the product, the mark leads the label. Full width under a finger, like any primary action on a phone.',
      },
    },
  },
  render: () => (
    <Stack gap={3}>
      <Button variant="invert" fullWidth startIcon={<ReachMark tile size={24} />}>
        Continue with Reach
      </Button>
      <Button fullWidth startIcon={<ReachMark tile size={24} />}>
        Open in Reach
      </Button>
    </Stack>
  ),
};
