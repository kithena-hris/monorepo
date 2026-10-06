import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Check, Clock, X } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';
import { userEvent } from 'storybook/test';

import { designDocs } from '../../docs/design.ts';
import { SegmentedControl, SegmentedControlItem } from '../segmented-control/segmented-control.tsx';
import { Text } from '../text/text.tsx';
import { Tabs, TabsList, TabsTrigger } from './tabs.tsx';

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  parameters: designDocs('tabs'),
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Tabs defaultValue="overview">
      <TabsList accessibilityLabel="Priya Shah">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="time-off">Time off</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>
    </Tabs>
  ),
};

export const WithIconsAndCounts: Story = {
  name: 'With icons and counts',
  render: () => (
    <Tabs defaultValue="pending">
      <TabsList scroll accessibilityLabel="Requests">
        <TabsTrigger value="pending" icon={Clock} count={4}>
          Pending
        </TabsTrigger>
        <TabsTrigger value="approved" icon={Check} count={12}>
          Approved
        </TabsTrigger>
        <TabsTrigger value="declined" icon={X}>
          Declined
        </TabsTrigger>
      </TabsList>
    </Tabs>
  ),
};

export const ManualActivation: Story = {
  name: 'Manual activation',
  // From the keyboard: into the tabs, then one to the right. Focus moves to
  // Time off; Overview stays open until Enter or Space.
  play: async () => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
  },
  render: () => (
    <View className="gap-2.5">
      <Tabs defaultValue="overview" activationMode="manual">
        <TabsList accessibilityLabel="Priya Shah">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="time-off">Time off</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>
      </Tabs>
      <Text variant="subhead" tone="muted" className="leading-[1.5]">
        Arrow keys move the focus. Enter or Space opens the tab, which suits tabs that load slowly.
      </Text>
    </View>
  ),
};

export const Controlled: Story = {
  render: function ControlledStory() {
    const [view, setView] = useState('month');
    return (
      <View className="gap-3">
        <Tabs value={view} onValueChange={setView}>
          <TabsList variant="pill" accessibilityLabel="Period">
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="quarter">Quarter</TabsTrigger>
          </TabsList>
        </Tabs>
        <SegmentedControl
          value={view}
          onValueChange={setView}
          fullWidth
          accessibilityLabel="Period"
        >
          <SegmentedControlItem value="week">Week</SegmentedControlItem>
          <SegmentedControlItem value="month">Month</SegmentedControlItem>
          <SegmentedControlItem value="quarter">Quarter</SegmentedControlItem>
        </SegmentedControl>
        <Text variant="subhead" tone="muted" className="leading-[1.5]">
          The parent owns the value and syncs it to the URL: ?view=month
        </Text>
      </View>
    );
  },
};
