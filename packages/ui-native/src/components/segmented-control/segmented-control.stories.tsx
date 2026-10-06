import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Kanban, LayoutGrid, List, Network } from 'lucide-react-native';

import { designDocs } from '../../docs/design.ts';
import { Card } from '../card/card.tsx';
import { Inline, Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { SegmentedControl, SegmentedControlItem } from './segmented-control.tsx';

const meta = {
  title: 'Components/Segmented control',
  component: SegmentedControl,
  parameters: designDocs('segmented-control'),
  args: { children: null },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Stack align="start">
      <SegmentedControl defaultValue="week" accessibilityLabel="Period">
        <SegmentedControlItem value="day">Day</SegmentedControlItem>
        <SegmentedControlItem value="week">Week</SegmentedControlItem>
        <SegmentedControlItem value="month">Month</SegmentedControlItem>
      </SegmentedControl>
    </Stack>
  ),
};

export const WithIcons: Story = {
  name: 'With icons',
  parameters: {
    docs: {
      description: {
        story: 'An icon-only segment needs an `accessibilityLabel`. It is the only name it has.',
      },
    },
  },
  render: () => (
    <Stack align="start" className="gap-2.5">
      <SegmentedControl defaultValue="list" accessibilityLabel="Layout">
        <SegmentedControlItem value="list" icon={List}>
          List
        </SegmentedControlItem>
        <SegmentedControlItem value="board" icon={Kanban}>
          Board
        </SegmentedControlItem>
        <SegmentedControlItem value="chart" icon={Network}>
          Chart
        </SegmentedControlItem>
      </SegmentedControl>
      <SegmentedControl defaultValue="grid" accessibilityLabel="Layout, compact">
        <SegmentedControlItem value="list" icon={List} accessibilityLabel="List" />
        <SegmentedControlItem value="grid" icon={LayoutGrid} accessibilityLabel="Grid" />
        <SegmentedControlItem value="chart" icon={Network} accessibilityLabel="Chart" />
      </SegmentedControl>
    </Stack>
  ),
};

export const FullWidth: Story = {
  name: 'Full width',
  render: () => (
    <SegmentedControl fullWidth defaultValue="pending" accessibilityLabel="Status">
      <SegmentedControlItem value="pending">Pending</SegmentedControlItem>
      <SegmentedControlItem value="approved">Approved</SegmentedControlItem>
      <SegmentedControlItem value="declined">Declined</SegmentedControlItem>
    </SegmentedControl>
  ),
};

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story: '32 compact and 36 by default. The desk’s large size is the default here.',
      },
    },
  },
  render: () => (
    <Stack align="start" className="gap-2.5">
      {(['sm', 'md'] as const).map((size) => (
        <SegmentedControl
          key={size}
          size={size}
          defaultValue="day"
          accessibilityLabel={`Period, ${size}`}
        >
          <SegmentedControlItem value="day">Day</SegmentedControlItem>
          <SegmentedControlItem value="week">Week</SegmentedControlItem>
        </SegmentedControl>
      ))}
    </Stack>
  ),
};

export const InAToolbar: Story = {
  name: 'In a toolbar',
  parameters: {
    docs: {
      description: { story: 'On a phone the request is the floating button, not a toolbar item.' },
    },
  },
  render: () => (
    <Card className="p-3">
      <Inline gap={3} wrap={false} className="gap-2.5">
        <Text variant="headline" weight="bold" className="flex-1">
          Time off
        </Text>
        <SegmentedControl size="sm" defaultValue="month" accessibilityLabel="Period">
          <SegmentedControlItem value="week">Week</SegmentedControlItem>
          <SegmentedControlItem value="month">Month</SegmentedControlItem>
        </SegmentedControl>
      </Inline>
    </Card>
  ),
};
