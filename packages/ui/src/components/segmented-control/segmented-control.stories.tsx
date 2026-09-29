import type { Meta, StoryObj } from '@storybook/react-vite';
import { Kanban, LayoutGrid, List, Network, Plus } from 'lucide-react';

import { Button } from '../button/button';
import { Card } from '../card/card';
import { SegmentedControl, SegmentedControlItem } from './segmented-control';

const meta = {
  title: 'Components/Segmented control',
  component: SegmentedControl,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Switches between 2 to 5 views of the same content. Use it when the options are short and equally important.',
          '',
          'A radio group to assistive tech: Tab reaches the selected segment, the arrow keys move the choice. One segment is always on, pressing it again does nothing, and a thumb slides to the new one (it snaps under reduced motion).',
          '',
          '| Reach for | When |',
          '| --- | --- |',
          '| `SegmentedControl` | One of a few views, always one on. |',
          '| `ToggleGroup` | Formatting, or a filter where none or several can be on. |',
          '| `Tabs` | The views are separate panels with their own content and URL. |',
          '| `Select` | More than five options, or labels too long for a phone. |',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    size: {
      description: 'Segment height. `lg` is for a desk; under a finger the sizes re-point.',
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    fullWidth: {
      description: 'Segments share the row equally.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'Appearance' },
    },
    value: {
      description: 'Controlled value. Pair with `onValueChange`.',
      control: false,
      table: { type: { summary: 'string' }, category: 'State' },
    },
    onValueChange: {
      description: 'Fires with the new value, never with an empty one.',
      control: false,
      table: { type: { summary: '(value: string) => void' }, category: 'Events' },
    },
  },
  args: { size: 'md', fullWidth: false, 'aria-label': 'Period' },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <SegmentedControl {...args} defaultValue="week">
      <SegmentedControlItem value="day">Day</SegmentedControlItem>
      <SegmentedControlItem value="week">Week</SegmentedControlItem>
      <SegmentedControlItem value="month">Month</SegmentedControlItem>
    </SegmentedControl>
  ),
};

export const WithIcons: Story = {
  name: 'With icons',
  parameters: {
    docs: {
      description: {
        story: 'An icon-only segment needs an `aria-label`. It is the only name the segment has.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col items-start gap-2.5">
      <SegmentedControl defaultValue="list" aria-label="Layout">
        <SegmentedControlItem value="list">
          <List aria-hidden="true" />
          List
        </SegmentedControlItem>
        <SegmentedControlItem value="board">
          <Kanban aria-hidden="true" />
          Board
        </SegmentedControlItem>
        <SegmentedControlItem value="chart">
          <Network aria-hidden="true" />
          Chart
        </SegmentedControlItem>
      </SegmentedControl>
      <SegmentedControl defaultValue="grid" aria-label="Layout, compact">
        <SegmentedControlItem value="list" iconOnly aria-label="List">
          <List aria-hidden="true" />
        </SegmentedControlItem>
        <SegmentedControlItem value="grid" iconOnly aria-label="Grid">
          <LayoutGrid aria-hidden="true" />
        </SegmentedControlItem>
        <SegmentedControlItem value="chart" iconOnly aria-label="Chart">
          <Network aria-hidden="true" />
        </SegmentedControlItem>
      </SegmentedControl>
    </div>
  ),
};

export const FullWidth: Story = {
  name: 'Full width',
  parameters: { layout: 'padded' },
  render: () => (
    <SegmentedControl fullWidth defaultValue="pending" aria-label="Status">
      <SegmentedControlItem value="pending">Pending</SegmentedControlItem>
      <SegmentedControlItem value="approved">Approved</SegmentedControlItem>
      <SegmentedControlItem value="declined">Declined</SegmentedControlItem>
    </SegmentedControl>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2.5">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <SegmentedControl key={size} size={size} defaultValue="day" aria-label={`Period, ${size}`}>
          <SegmentedControlItem value="day">Day</SegmentedControlItem>
          <SegmentedControlItem value="week">Week</SegmentedControlItem>
        </SegmentedControl>
      ))}
    </div>
  ),
};

export const InAToolbar: Story = {
  name: 'In a toolbar',
  parameters: { layout: 'padded' },
  render: () => (
    <Card className="flex items-center gap-2.5 p-3">
      <h3 className="text-md font-bold">Time off</h3>
      <SegmentedControl size="sm" defaultValue="month" aria-label="Period" className="ms-auto">
        <SegmentedControlItem value="week">Week</SegmentedControlItem>
        <SegmentedControlItem value="month">Month</SegmentedControlItem>
      </SegmentedControl>
      {/* On a phone the request is the floating button, not a toolbar item. */}
      <Button
        variant="primary"
        size="sm"
        startIcon={<Plus aria-hidden="true" />}
        className="touch:hidden"
      >
        Request
      </Button>
    </Card>
  ),
};
