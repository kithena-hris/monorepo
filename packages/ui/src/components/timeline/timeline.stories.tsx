import type { Meta, StoryObj } from '@storybook/react-vite';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { CopyButton } from '../clipboard/clipboard';
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
        <TimelineItem
          title="Request submitted"
          timestamp="4 Aug, 09:12"
          tone="accent"
          marker={<Avatar size="xs" name="Grace Hopper" className="mt-0.5" />}
        >
          Annual leave, 3 days, 14–16 September.
        </TimelineItem>
        <TimelineItem
          title="Approved by Radia Perlman"
          timestamp="4 Aug, 14:38"
          tone="success"
          marker={<Avatar size="xs" name="Radia Perlman" className="mt-0.5" />}
        >
          Balance after approval: 12 days.
        </TimelineItem>
        <TimelineItem title="Pushed to calendar" timestamp="4 Aug, 14:38" tone="neutral" last>
          Written to the employee&apos;s work calendar as an all-day event.
        </TimelineItem>
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
          'The reason this component prints two dates. Read the second entry: recorded on 15 August, effective from 1 August. That fortnight is the retroactive delta payroll has to pay, and it is invisible on any timeline that shows only one date.',
      },
    },
  },
  render: () => (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Grace Hopper: compensation history</CardTitle>
      </CardHeader>
      <CardContent>
        <Timeline>
          <TimelineItem
            title="Hired"
            timestamp="Recorded 4 Mar 2024"
            effectiveFrom="4 March 2024"
            tone="neutral"
          >
            Staff Engineer, Platform. Base{' '}
            <Money minorUnits="9800000" currency="EUR" locale="en-IE" />.
          </TimelineItem>
          <TimelineItem
            title="Promotion to Principal Engineer"
            timestamp="Recorded 15 Aug 2026"
            effectiveFrom="1 August 2026"
            tone="accent"
          >
            Base raised to <Money minorUnits="14200000" currency="EUR" locale="en-IE" />. Two weeks
            of retroactive difference will settle in the September run.
          </TimelineItem>
          <TimelineItem
            title="Correction: bonus target"
            timestamp="Recorded 18 Aug 2026"
            effectiveFrom="1 August 2026"
            tone="warning"
          >
            <p>
              Bonus target corrected from 10% to 15%. Supersedes the value recorded on 15 August.
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-fg-subtle">
              Correction event · supersedes
              <code className="font-mono">01J9…c4f2</code>
              <CopyButton
                value="01J9F3K8QW7X2N5R4T6Y9B1c4f2"
                label="Copy the superseded event id"
              />
            </p>
          </TimelineItem>
          <TimelineItem
            title="Next review scheduled"
            timestamp="Recorded 18 Aug 2026"
            effectiveFrom="1 January 2027"
            tone="neutral"
            last
          />
        </Timeline>
      </CardContent>
    </Card>
  ),
};

export const ApprovalChain: Story = {
  name: 'An approval chain in progress',
  parameters: {
    docs: {
      description: {
        story:
          'A chain that has not finished. The pending step is drawn but its dot is neutral and its text is muted, the timeline is a record of what has happened, so anything that has not happened must not look like it has.',
      },
    },
  },
  render: () => (
    <div className="max-w-lg">
      <Timeline>
        <TimelineItem
          title="Submitted"
          timestamp="7 Aug, 11:02"
          tone="success"
          marker={<Avatar size="xs" name="Katherine Johnson" className="mt-0.5" />}
        >
          Unpaid leave, 10 days, 1–12 October.
        </TimelineItem>
        <TimelineItem
          title="Approved by the line manager"
          timestamp="7 Aug, 16:20"
          tone="success"
          marker={<Avatar size="xs" name="Barbara Liskov" className="mt-0.5" />}
        />
        <TimelineItem
          title={
            <span className="flex items-center gap-2">
              People Ops review
              <Badge tone="warning" size="sm" dot>
                Pending
              </Badge>
            </span>
          }
          timestamp="Due 12 Aug"
          tone="neutral"
        >
          Unpaid leave over 5 days requires a second approval.
        </TimelineItem>
        <TimelineItem title="Payroll adjustment" tone="neutral" last>
          <span className="text-fg-subtle">Will run once the review completes.</span>
        </TimelineItem>
      </Timeline>
    </div>
  ),
};

export const Tones: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Every dot tone. The dot never carries the meaning alone, the title does, and colour reinforces it. Roughly one man in twelve cannot separate the green and red dots.',
      },
    },
  },
  render: () => (
    <div className="max-w-md">
      <Timeline>
        <TimelineItem title="Neutral, a recorded fact" tone="neutral" timestamp="09:00" />
        <TimelineItem title="Accent, the current step" tone="accent" timestamp="09:14" />
        <TimelineItem title="Success, a terminal good outcome" tone="success" timestamp="10:02" />
        <TimelineItem title="Warning: needs a human" tone="warning" timestamp="10:40" />
        <TimelineItem title="Danger, a terminal bad outcome" tone="danger" timestamp="11:15" last />
      </Timeline>
    </div>
  ),
};
