import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { AutoGrid, Stack } from '../components/layout/layout.tsx';
import { Text } from '../components/text/text.tsx';
import { designDocs } from '../docs/design.ts';
import { ReachLogo, ReachMark } from './reach-logo.tsx';

/*
 * Reach's own mark and lockup, and nothing else. This Storybook is public and
 * documents Reach on its own; no other product's mark belongs here.
 */
const meta = {
  title: 'Foundations/Brand',
  component: ReachLogo,
  parameters: designDocs('brand'),
} satisfies Meta<typeof ReachLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Logo: Story = {
  name: 'The lockup',
  args: { size: 48 },
};

export const Sizes: Story = {
  name: 'At size',
  parameters: {
    docs: {
      description: {
        story:
          'The word is two thirds of the mark’s height and the gap a little over a third, so every size is the same lockup scaled.',
      },
    },
  },
  render: () => (
    <Stack gap={5} align="start">
      <ReachLogo size={56} />
      <ReachLogo size={32} />
      <ReachLogo size={20} />
    </Stack>
  ),
};

const SURFACES = [
  ['bg-canvas', 'accent', 'default'],
  ['bg-surface', 'accent', 'default'],
  ['bg-accent-solid', 'light', 'on-accent'],
  ['bg-invert', 'accent', 'on-invert'],
] as const;

export const OnSurfaces: Story = {
  name: 'On any surface',
  parameters: {
    docs: {
      description: {
        story:
          'On the accent ground the tile turns light, so the mark is not an accent square on an accent field.',
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth={150} gap={3}>
      {SURFACES.map(([ground, tone, word]) => (
        <View
          key={ground}
          className={`h-24 items-center justify-center rounded-lg border border-border ${ground}`}
        >
          <ReachLogo size={26} tone={tone} wordTone={word} />
        </View>
      ))}
    </AutoGrid>
  ),
};

/** The construction grid: 8 × 8 squares of 30 across a 240 frame. */
const LINES = [30, 60, 90, 120, 150, 180, 210];

export const Construction: Story = {
  render: () => (
    <Stack gap={3} align="center">
      <View className="size-60 items-center justify-center overflow-hidden rounded-lg border border-border">
        {LINES.map((at) => (
          <View
            key={`h${String(at)}`}
            aria-hidden
            className="absolute right-0 left-0 h-px bg-border"
            style={{ top: at }}
          />
        ))}
        {LINES.map((at) => (
          <View
            key={`v${String(at)}`}
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-border"
            style={{ left: at }}
          />
        ))}
        <ReachMark tile size={180} title="The Reach mark on its construction grid" />
        <View
          aria-hidden
          className="absolute rounded-[50px] border-[1.5px] border-dashed border-danger"
          style={{ top: 30, right: 30, bottom: 30, left: 30 }}
        />
      </View>
      <Text variant="subhead" tone="muted" className="text-center">
        8 × 8 grid, 9/32 corner radius, 2.8 stroke. The red line is the clear space.
      </Text>
    </Stack>
  ),
};
