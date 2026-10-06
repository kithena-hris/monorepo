import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import {
  Bold,
  Italic,
  LayoutGrid,
  List,
  Network,
  Star,
  Strikethrough,
  Underline,
} from 'lucide-react-native';
import { useState } from 'react';

import { designDocs } from '../../docs/design.ts';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { Toggle, ToggleGroup, ToggleGroupItem, type ToggleProps } from './toggle.tsx';

const meta = {
  title: 'Forms/Toggle',
  component: Toggle,
  parameters: designDocs('toggle'),
} satisfies Meta<typeof Toggle>;

export default meta;
// Every story renders its own; no args are shared.
type Story = StoryObj;

function Live({
  initial,
  ...props
}: Omit<ToggleProps, 'pressed' | 'onPressedChange'> & { initial: boolean }): React.JSX.Element {
  const [pressed, setPressed] = useState(initial);
  return <Toggle pressed={pressed} onPressedChange={setPressed} {...props} />;
}

export const Playground: Story = {
  render: () => (
    <Inline gap={2}>
      <Live initial icon={Bold}>
        Bold
      </Live>
      <Live initial={false} icon={Bold}>
        Bold
      </Live>
    </Inline>
  ),
};

export const Variants: Story = {
  render: () => (
    <Inline gap={2}>
      <Live initial>Fill</Live>
      <Live initial={false}>Fill</Live>
      <Live initial variant="outline">
        Outline
      </Live>
      <Live initial={false} variant="outline">
        Outline
      </Live>
      <Live initial variant="ghost">
        Ghost
      </Live>
      <Live initial={false} variant="ghost">
        Ghost
      </Live>
    </Inline>
  ),
};

export const IconOnly: Story = {
  name: 'Icon only',
  render: () => (
    <Inline className="gap-1.5">
      <Live initial shape="square" icon={Bold} accessibilityLabel="Bold" />
      <Live initial={false} shape="square" icon={Italic} accessibilityLabel="Italic" />
      <Live initial={false} shape="square" icon={Underline} accessibilityLabel="Underline" />
      <Live initial icon={Star} accessibilityLabel="Favourite" />
    </Inline>
  ),
};

function OneOfSeveral(): React.JSX.Element {
  const [range, setRange] = useState<string | undefined>('week');
  const [view, setView] = useState<string | undefined>('list');
  return (
    <Stack gap={3}>
      <ToggleGroup
        type="single"
        value={range}
        onValueChange={setRange}
        fullWidth
        accessibilityLabel="Range"
      >
        <ToggleGroupItem value="day">Day</ToggleGroupItem>
        <ToggleGroupItem value="week">Week</ToggleGroupItem>
        <ToggleGroupItem value="month">Month</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup type="single" value={view} onValueChange={setView} accessibilityLabel="View">
        <ToggleGroupItem value="list" icon={List} accessibilityLabel="List" />
        <ToggleGroupItem value="grid" icon={LayoutGrid} accessibilityLabel="Grid" />
        <ToggleGroupItem value="chart" icon={Network} accessibilityLabel="Org chart" />
      </ToggleGroup>
    </Stack>
  );
}

export const SegmentedOneOfSeveral: Story = {
  name: 'Segmented, one of several',
  render: () => <OneOfSeveral />,
};

function SeveralAtOnce(): React.JSX.Element {
  const [marks, setMarks] = useState<string[]>(['bold', 'underline']);
  return (
    <Stack gap={3}>
      <ToggleGroup
        type="multiple"
        value={marks}
        onValueChange={setMarks}
        accessibilityLabel="Formatting"
      >
        <ToggleGroupItem value="bold" icon={Bold} accessibilityLabel="Bold" />
        <ToggleGroupItem value="italic" icon={Italic} accessibilityLabel="Italic" />
        <ToggleGroupItem value="underline" icon={Underline} accessibilityLabel="Underline" />
        <ToggleGroupItem value="strike" icon={Strikethrough} accessibilityLabel="Strikethrough" />
      </ToggleGroup>
      <Text variant="subhead" tone="muted">
        Several can be on at once. Each one is its own toggle.
      </Text>
    </Stack>
  );
}

export const SegmentedSeveralAtOnce: Story = {
  name: 'Segmented: several at once',
  render: () => <SeveralAtOnce />,
};

export const Sizes: Story = {
  render: () => (
    <Inline gap={2}>
      <Live initial size="sm">
        Small
      </Live>
      <Live initial>Default</Live>
    </Inline>
  ),
};
