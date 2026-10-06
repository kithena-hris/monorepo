import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Check, Clock, Send, Wallet } from 'lucide-react-native';

import { designDocs } from '../../docs/design.ts';
import { Text } from '../text/text.tsx';
import { Timeline, TimelineItem } from './timeline.tsx';

const meta = {
  title: 'Components/Timeline',
  component: TimelineItem,
  parameters: designDocs('timeline'),
  args: { title: 'Joined Reach' },
} satisfies Meta<typeof TimelineItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Timeline accessibilityLabel="Career">
      <TimelineItem title="Joined Reach" timestamp="2 Sep 2024" tone="accent" />
      <TimelineItem title="Promoted to Senior Engineer" timestamp="1 Apr 2026" tone="success" />
      <TimelineItem title="Moved to Platform team" timestamp="1 Jul 2026" tone="info" />
    </Timeline>
  ),
};

export const EffectiveDating: Story = {
  name: 'Effective dating',
  render: () => (
    <Timeline accessibilityLabel="Salary">
      <TimelineItem title="Salary €86,000" timestamp="Until 31 Mar">
        Past
      </TimelineItem>
      <TimelineItem title="Salary €92,000" timestamp="From 1 Apr" tone="accent">
        <Text variant="subhead" weight="bold" className="leading-[1.5]">
          Current
        </Text>
      </TimelineItem>
      <TimelineItem
        title="Salary €96,000"
        timestamp="From 1 Jan 2027"
        tone="info"
        status="upcoming"
      >
        Scheduled, not yet in effect
      </TimelineItem>
    </Timeline>
  ),
};

export const AnApprovalChainInProgress: Story = {
  name: 'An approval chain in progress',
  render: () => (
    <Timeline accessibilityLabel="Approval">
      <TimelineItem title="Submitted by Amara" timestamp="09:12" icon={Send} tone="accent" />
      <TimelineItem title="Approved by Jonas Weber" timestamp="10:40" icon={Check} tone="success" />
      <TimelineItem
        title="Waiting for Nora Becker"
        timestamp="Now"
        icon={Clock}
        tone="warning"
        status="current"
      />
      <TimelineItem title="Payroll" icon={Wallet} status="upcoming" />
    </Timeline>
  ),
};

export const Tones: Story = {
  render: () => (
    <Timeline accessibilityLabel="Tones">
      {(['neutral', 'accent', 'success', 'warning', 'danger', 'info'] as const).map((tone) => (
        <TimelineItem
          key={tone}
          title={`${tone.charAt(0).toUpperCase()}${tone.slice(1)}`}
          tone={tone}
        />
      ))}
    </Timeline>
  ),
};
