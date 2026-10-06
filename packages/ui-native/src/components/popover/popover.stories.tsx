import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Calendar, ChevronDown, Columns3, Filter, GripVertical } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { StandInCheck, StandInField, StandInSegmented, settled } from '../../docs/stage.tsx';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { Text } from '../text/text.tsx';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './popover.tsx';

const meta = {
  title: 'Components/Popover',
  component: PopoverContent,
  parameters: designDocs('popover'),
  // axe runs after this, on the open popover, not on its fade in.
  play: settled,
} satisfies Meta<typeof PopoverContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <View className="min-h-[170px] items-start">
      <Popover defaultOpen>
        <PopoverTrigger>
          <Button endIcon={<Icon icon={ChevronDown} />}>Details</Button>
        </PopoverTrigger>
        <PopoverContent label="Working hours" className="w-[260px] gap-1">
          <Text weight="semibold">Working hours</Text>
          <Text variant="subhead" tone="muted" className="leading-[1.5]">
            Mon–Fri, 9:00–17:30 CET
          </Text>
          <Text variant="subhead" tone="muted" className="leading-[1.5]">
            Core hours 10:00–16:00
          </Text>
        </PopoverContent>
      </Popover>
    </View>
  ),
};

const COLUMNS = ['Name', 'Team', 'Location', 'Status', 'Start date', 'Salary'];

export const ColumnChooser: Story = {
  name: 'A working column chooser',
  render: () => (
    <View className="min-h-[460px] items-start">
      <Popover defaultOpen>
        <PopoverTrigger>
          <Button size="sm" startIcon={<Icon icon={Columns3} />}>
            Columns
          </Button>
        </PopoverTrigger>
        <PopoverContent label="Columns" className="w-[260px] gap-0.5">
          <Text weight="semibold">Columns</Text>
          {COLUMNS.map((column, i) => (
            <View key={column} className="min-h-m-tap flex-row items-center gap-2.5">
              <Icon icon={GripVertical} size={15} tone="subtle" />
              <StandInCheck label={column} defaultChecked={i < 5} />
            </View>
          ))}
          <View className="mt-1.5 flex-row justify-between">
            <Button size="sm" variant="ghost">
              Reset
            </Button>
            <PopoverClose asChild>
              <Button size="sm" variant="primary">
                Done
              </Button>
            </PopoverClose>
          </View>
        </PopoverContent>
      </Popover>
    </View>
  ),
};

export const Sides: Story = {
  name: 'Every side',
  render: () => (
    <View className="min-h-[200px] gap-3">
      <Text variant="subhead" tone="muted" className="leading-[1.5]">
        On a phone a popover opens below its trigger, or above it when there is no room below.
      </Text>
      <View className="items-start">
        <Popover defaultOpen>
          <PopoverTrigger>
            <Button size="sm">Anchor</Button>
          </PopoverTrigger>
          <PopoverContent label="Anchored content" className="w-[358px]">
            <Text variant="subhead" tone="muted">
              Anchored content
            </Text>
          </PopoverContent>
        </Popover>
      </View>
    </View>
  ),
};

export const HoldingARealControl: Story = {
  name: 'Holding a real control',
  render: function HoldingStory() {
    const [status, setStatus] = useState('Active');
    return (
      <View className="min-h-[330px] items-start">
        <Popover defaultOpen>
          <PopoverTrigger>
            <Button startIcon={<Icon icon={Filter} />}>Filter</Button>
          </PopoverTrigger>
          <PopoverContent label="Filter" className="w-[300px] gap-2.5">
            <Text weight="semibold">Start date</Text>
            <StandInField
              value="After 1 Jan 2024"
              accessibilityLabel="Start date"
              small
              end={<Icon icon={Calendar} size={17} tone="muted" />}
            />
            <Text weight="semibold">Status</Text>
            <StandInSegmented
              label="Status"
              options={['Any', 'Active', 'Leave']}
              value={status}
              onChange={setStatus}
            />
            <View className="flex-row justify-end gap-1.5">
              <Button size="sm" variant="ghost">
                Clear
              </Button>
              <PopoverClose asChild>
                <Button size="sm" variant="primary">
                  Apply
                </Button>
              </PopoverClose>
            </View>
          </PopoverContent>
        </Popover>
      </View>
    );
  },
};
