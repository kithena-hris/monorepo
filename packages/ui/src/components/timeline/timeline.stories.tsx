import type { Meta, StoryObj } from '@storybook/react-vite';
import { Check, Clock, Send, Wallet } from 'lucide-react';

import { Money } from '../money/money';
import { Timeline, TimelineItem } from './timeline';

const meta = {
  title: 'Components/Timeline',
  component: Timeline,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          "An ordered history: an approval chain, an audit trail, a record's revisions.",
          '',
          '### Why this belongs in the system',
          '',
          'This is the shape an event-sourced HRIS produces naturally. Corrections here are typed events carrying `supersedes`, never silent updates, so "what did this record look like in March, and who changed it?" is a question the data can answer, and this is the component that answers it.',
          '',
          '### Two dates, and why both are printed',
          '',
          '`occurredAt` is when we recorded it. `effectiveFrom` is when it takes effect in the domain. A promotion entered on the 15th and effective on the 1st has both, and payroll cannot compute the retroactive delta without them. A timeline that prints one date is a timeline that cannot explain a back-dated payslip.',
          '',
          '### Markup',
          '',
          'An `<ol>`, because the order is the meaning. The connector is a pseudo-element rather than a list item, so a screen reader reads five events and not five events interleaved with five vertical lines.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    children: {
      description: '`TimelineItem` elements, newest first or oldest first: pick one and hold it.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {},
} satisfies Meta<typeof Timeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="max-w-lg">
      <Timeline {...args}>
        <TimelineItem title="Joined Reach" timestamp="2 Sep 2024" tone="accent" />
        <TimelineItem title="Promoted to Senior Engineer" timestamp="1 Apr 2026" tone="success" />
        <TimelineItem title="Moved to Platform team" timestamp="1 Jul 2026" tone="info" last />
      </Timeline>
    </div>
  ),
};

export const EffectiveDating: Story = {
  name: 'Effective dating',
  parameters: {
    docs: {
      description: {
        story:
          'A salary over time. The past value is closed, the current one is marked in words, and the scheduled change is hollow with a dashed line into it: recorded today, not yet in effect, and still able to be withdrawn.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-lg">
      <Timeline {...args}>
        <TimelineItem
          title={
            <>
              Salary <Money minorUnits="8600000" currency="EUR" locale="en-IE" />
            </>
          }
          timestamp="Until 31 Mar"
        >
          Past
        </TimelineItem>
        <TimelineItem
          title={
            <>
              Salary <Money minorUnits="9200000" currency="EUR" locale="en-IE" />
            </>
          }
          timestamp="From 1 Apr"
          tone="accent"
        >
          <strong className="font-semibold text-fg">Current</strong>
        </TimelineItem>
        <TimelineItem
          title={
            <>
              Salary <Money minorUnits="9600000" currency="EUR" locale="en-IE" />
            </>
          }
          timestamp="From 1 Jan 2027"
          tone="info"
          status="upcoming"
          last
        >
          Scheduled, not yet in effect
        </TimelineItem>
      </Timeline>
    </div>
  ),
};

export const ApprovalChain: Story = {
  name: 'An approval chain in progress',
  parameters: {
    docs: {
      description: {
        story:
          'A glyph per kind of step. The step being waited on pulses, so it is the one the eye lands on, and the step after it is hollow with a dashed line: nobody has reached it yet.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-lg">
      <Timeline {...args}>
        <TimelineItem title="Submitted by Amara" timestamp="09:12" tone="accent" icon={<Send />} />
        <TimelineItem
          title="Approved by Jonas Weber"
          timestamp="10:40"
          tone="success"
          icon={<Check />}
        />
        <TimelineItem
          title="Waiting for Nora Becker"
          timestamp="Now"
          tone="warning"
          icon={<Clock />}
          status="current"
        />
        <TimelineItem title="Payroll" icon={<Wallet />} status="upcoming" last />
      </Timeline>
    </div>
  ),
};

export const Tones: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The dot takes a tone, but it carries no meaning on its own: the title does. Tone helps a reader scan a long history for the kind of event they are after.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-lg">
      <Timeline {...args}>
        {(['neutral', 'accent', 'success', 'warning', 'danger', 'info'] as const).map(
          (tone, index, all) => (
            <TimelineItem
              key={tone}
              tone={tone}
              title={`${tone.charAt(0).toUpperCase()}${tone.slice(1)}`}
              last={index === all.length - 1}
            />
          ),
        )}
      </Timeline>
    </div>
  ),
};
