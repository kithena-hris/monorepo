import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDays, TrendingDown, Users, Wallet } from 'lucide-react';

import { Sparkline } from '../chart/chart';
import { Money } from '../money/money';
import { Stat } from './stat';

const meta = {
  title: 'Components/Stat',
  component: Stat,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A single headline number, for the top of a dashboard.',
          '',
          '### Two rules that keep a dashboard honest',
          '',
          '**A delta needs a period.** `+12%` is not information; `+12% vs last quarter` is. `deltaLabel` exists to force the question, and a `delta` without one is a review comment.',
          '',
          '**Up is not good.** Headcount up is growth. Attrition up is a problem. Time-to-hire up is a problem. That is why `direction` (which way the number moved) and `sentiment` (whether that is good) are separate props: collapsing them into one is how a resignation spike gets painted green.',
          '',
          '### Sizing',
          '',
          'The tile is a container query (`@container`), not a breakpoint. The same component is dropped into a four-across desktop grid, a two-across tablet grid and a 320px sidebar, and only the tile itself knows which one it landed in, the viewport is identical in all three.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    label: {
      description:
        'What the number is. Rendered small and uppercase; keep it to two or three words.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Content' },
    },
    value: {
      description:
        'The number itself. Pass a `<Money>` for currency, never a float, and never a string you formatted by hand.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    delta: {
      description: 'The change, pre-formatted: `+12%`, `−4 days`, `+18`.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Content' },
    },
    deltaLabel: {
      description:
        'What the delta is measured against. Required whenever `delta` is set, a change with no period is a number with no meaning.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Content' },
    },
    direction: {
      description: 'Which way the number moved. Chooses the arrow only.',
      control: 'inline-radio',
      options: ['up', 'down', 'flat'],
      table: {
        type: { summary: "'up' | 'down' | 'flat'" },
        defaultValue: { summary: 'flat' },
        category: 'Meaning',
      },
    },
    sentiment: {
      description:
        'Whether that movement is good news. Chooses the colour. Deliberately independent of `direction`.',
      control: 'inline-radio',
      options: ['positive', 'negative', 'neutral'],
      table: {
        type: { summary: "'positive' | 'negative' | 'neutral'" },
        defaultValue: { summary: 'neutral' },
        category: 'Meaning',
      },
    },
    chart: {
      description: 'A `Sparkline` or other small chart, rendered under the value.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    icon: {
      description: 'A small glyph in the top-right. Decorative, it must not carry meaning alone.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Headcount',
    value: '912',
    delta: '+18',
    deltaLabel: 'this quarter',
    direction: 'up',
    sentiment: 'positive',
  },
} satisfies Meta<typeof Stat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="max-w-xs">
      <Stat {...args} />
    </div>
  ),
};

export const DirectionIsNotSentiment: Story = {
  name: 'Direction is not sentiment',
  parameters: {
    docs: {
      description: {
        story:
          'All four combinations. Read the second tile: attrition went **up**, and that is **bad**, the arrow points up and the colour is red. A component that inferred the colour from the arrow could not express this row.',
      },
    },
  },
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Headcount"
        value="912"
        delta="+18"
        deltaLabel="this quarter"
        direction="up"
        sentiment="positive"
        icon={<Users />}
      />
      <Stat
        label="Voluntary attrition"
        value="8.4%"
        delta="+1.2pp"
        deltaLabel="vs Q1"
        direction="up"
        sentiment="negative"
        icon={<TrendingDown />}
      />
      <Stat
        label="Time to hire"
        value="38 days"
        delta="−6 days"
        deltaLabel="vs Q1"
        direction="down"
        sentiment="positive"
        icon={<CalendarDays />}
      />
      <Stat
        label="Offer acceptance"
        value="74%"
        delta="−9pp"
        deltaLabel="vs Q1"
        direction="down"
        sentiment="negative"
      />
    </div>
  ),
};

export const WithMoney: Story = {
  name: 'With money',
  parameters: {
    docs: {
      description: {
        story:
          'Currency goes through `<Money>`, which takes minor units as a string and formats through `Intl`. A payroll total is the last place to discover that a float lost a cent.',
      },
    },
  },
  render: () => (
    <div className="grid gap-4 sm:grid-cols-3">
      <Stat
        label="Monthly payroll"
        value={<Money minorUnits="98345000" currency="EUR" locale="en-IE" />}
        delta="+2.1%"
        deltaLabel="vs July"
        direction="up"
        sentiment="neutral"
        icon={<Wallet />}
      />
      <Stat
        label="Average base salary"
        value={<Money minorUnits="7241500" currency="EUR" locale="en-IE" />}
        delta="+€1,340"
        deltaLabel="vs Q1"
        direction="up"
        sentiment="neutral"
      />
      <Stat
        label="Unbudgeted spend"
        value={<Money minorUnits="418000" currency="EUR" locale="en-IE" />}
        delta="+€4,180"
        deltaLabel="vs plan"
        direction="up"
        sentiment="negative"
      />
    </div>
  ),
};

export const WithSparkline: Story = {
  name: 'With a sparkline',
  parameters: {
    docs: {
      description: {
        story:
          'A delta says where it moved; a sparkline says how it got there. The difference matters when a number is flat month-on-month after a spike and a recovery.',
      },
    },
  },
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2">
      <Stat
        label="Headcount"
        value="912"
        delta="+8.3%"
        deltaLabel="vs February"
        direction="up"
        sentiment="positive"
        chart={
          <Sparkline
            label="Headcount, last 7 months"
            data={[
              { label: 'Feb', value: 842 },
              { label: 'Mar', value: 858 },
              { label: 'Apr', value: 861 },
              { label: 'May', value: 874 },
              { label: 'Jun', value: 889 },
              { label: 'Jul', value: 902 },
              { label: 'Aug', value: 912 },
            ]}
          />
        }
      />
      <Stat
        label="Absence rate"
        value="3.1%"
        delta="flat"
        deltaLabel="vs July"
        direction="flat"
        sentiment="neutral"
        chart={
          <Sparkline
            label="Absence rate, last 7 months"
            tone="warning"
            data={[
              { label: 'Feb', value: 2.8 },
              { label: 'Mar', value: 4.9 },
              { label: 'Apr', value: 5.4 },
              { label: 'May', value: 3.9 },
              { label: 'Jun', value: 3.0 },
              { label: 'Jul', value: 3.1 },
              { label: 'Aug', value: 3.1 },
            ]}
          />
        }
      />
    </div>
  ),
};

export const InANarrowColumn: Story = {
  name: 'In a narrow column',
  parameters: {
    docs: {
      description: {
        story:
          'The left column is 240px, the right is full width. The value steps down a size in the narrow one, from the container query, not from the viewport, which is identical for both.',
      },
    },
  },
  render: () => (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <Stat
        label="Pending approvals"
        value="7"
        delta="+3"
        deltaLabel="since Monday"
        direction="up"
        sentiment="negative"
      />
      <Stat
        label="Pending approvals"
        value="7"
        delta="+3"
        deltaLabel="since Monday"
        direction="up"
        sentiment="negative"
      />
    </div>
  ),
};
