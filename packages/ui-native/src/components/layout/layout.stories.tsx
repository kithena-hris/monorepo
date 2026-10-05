import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Text } from '../text/text.tsx';
import { AutoGrid, Container, Inline, Split, Stack } from './layout.tsx';

const meta = {
  title: 'Components/Layout',
  component: Stack,
  parameters: designDocs('layout'),
} satisfies Meta<typeof Stack>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A placeholder block, so the space between things is what the story shows. */
function Block({
  children,
  className,
}: {
  children: string;
  className?: string;
}): React.JSX.Element {
  return (
    <View
      className={`min-h-m-tap items-center justify-center rounded-sm bg-accent-subtle px-3.5 ${className ?? ''}`}
    >
      <Text variant="footnote" weight="semibold" tone="accent">
        {children}
      </Text>
    </View>
  );
}

function Cell({ n }: { n: number }): React.JSX.Element {
  return (
    <View className="h-14 items-center justify-center rounded-sm bg-accent-subtle">
      <Text variant="footnote" weight="semibold" tone="accent">
        {String(n)}
      </Text>
    </View>
  );
}

export const AutoGridPlayground: Story = {
  name: 'AutoGrid',
  parameters: {
    docs: {
      description: {
        story:
          'As many columns as fit at the minimum width, asked of the space the grid was given.',
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth={90} gap={2}>
      {Array.from({ length: 8 }, (_, i) => (
        <Cell key={i} n={i + 1} />
      ))}
    </AutoGrid>
  ),
};

export const AutoGridInThreeContainers: Story = {
  name: 'The same AutoGrid in three containers',
  render: () => (
    <Stack gap={2} className="gap-2.5">
      {(['100%', '66%', '40%'] as const).map((width) => (
        <View key={width} className="rounded-md border border-border p-2" style={{ width }}>
          <AutoGrid minItemWidth={90} gap={2}>
            {Array.from({ length: 6 }, (_, i) => (
              <Cell key={i} n={i + 1} />
            ))}
          </AutoGrid>
          <Text variant="subhead" tone="muted" className="mt-1.5">
            {`Container ${width}`}
          </Text>
        </View>
      ))}
    </Stack>
  ),
};

export const StackAndInline: Story = {
  name: 'Stack and Inline',
  render: () => (
    <Stack gap={5}>
      <Stack gap={3}>
        <Block>Stack · gap 12</Block>
        <Block>Item</Block>
        <Block>Item</Block>
      </Stack>
      <Inline gap={2}>
        <Block>Inline</Block>
        <Block>gap 8</Block>
        <Block>wraps</Block>
        <Block>when full</Block>
      </Inline>
    </Stack>
  ),
};

export const SplitLayout: Story = {
  name: 'Split',
  parameters: {
    docs: {
      description: {
        story:
          'A row whose ends pull apart, then main content and an aside, which on a phone stack: no phone is wide enough for a rail.',
      },
    },
  },
  render: () => (
    <Stack gap={3} className="gap-2.5">
      <Inline gap={3} justify="between">
        <Block className="min-w-[140px] flex-1">Start</Block>
        <Block className="w-[120px]">End</Block>
      </Inline>
      <Split gap={3} aside={<Block>Aside · 1fr</Block>}>
        <Block>Main · 2fr</Block>
      </Split>
    </Stack>
  ),
};

export const ContainerSizes: Story = {
  name: 'Container',
  render: () => (
    <View className="rounded-md border border-border py-3">
      <Container gutter={false} className="max-w-[70%]">
        <Block>max-width 1280 · centred · margin from breakpoint</Block>
      </Container>
    </View>
  ),
};

const JUSTIFY = [
  ['start', 'justify start'],
  ['center', 'centre'],
  ['between', 'space between'],
  ['end', 'justify end'],
] as const;

export const FlexOptions: Story = {
  name: 'Flex options',
  render: () => (
    <Stack gap={2}>
      {JUSTIFY.map(([justify, label]) => (
        <Inline
          key={justify}
          justify={justify}
          gap={2}
          className="rounded-sm border border-border p-2"
        >
          <Block>{label}</Block>
          <Block>B</Block>
        </Inline>
      ))}
    </Stack>
  ),
};
