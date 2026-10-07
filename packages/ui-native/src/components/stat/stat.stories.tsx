import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { Sparkline } from '../chart/trend-chart.tsx';
import { AutoGrid } from '../layout/layout.tsx';
import { Money } from '../money/money.tsx';
import { Stat } from './stat.tsx';

const meta = {
  title: 'Components/Stat',
  component: Stat,
  parameters: designDocs('stat'),
  args: { label: 'Headcount', value: '312', delta: '+12 this quarter', direction: 'up', sentiment: 'positive' },
} satisfies Meta<typeof Stat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const DirectionIsNotSentiment: Story = {
  name: 'Direction is not sentiment',
  render: () => (
    <AutoGrid minItemWidth={150} gap={3}>
      <Stat
        label="Attrition"
        value="6.1"
        unit="%"
        delta="0.8 pts lower"
        direction="down"
        sentiment="positive"
      />
      <Stat label="Open roles" value="18" delta="4 more" direction="up" sentiment="negative" />
      <Stat label="Avg. tenure" value="2.4" unit="yrs" delta="No change" direction="flat" />
    </AutoGrid>
  ),
};

export const WithMoney: Story = {
  name: 'With money',
  render: () => (
    <AutoGrid minItemWidth={150} gap={3}>
      <Stat
        label="Payroll, September"
        value={<Money minorUnits="128430000" currency="EUR" locale="en-GB" exponent={2} hideFraction />}
        delta="+2.1% on August"
        direction="up"
      />
      <Stat
        label="Unclaimed expenses"
        value={<Money minorUnits="348000" currency="EUR" locale="en-GB" hideFraction />}
        delta="14 people"
        direction="up"
        sentiment="negative"
      />
    </AutoGrid>
  ),
};

const trend = (values: readonly number[]): { label: string; value: number }[] =>
  values.map((value, i) => ({ label: String(i + 1), value }));

export const WithASparkline: Story = {
  name: 'With a sparkline',
  render: () => (
    <AutoGrid minItemWidth={150} gap={3}>
      <Stat
        label="Headcount"
        value="312"
        direction="up"
        delta="+18.6% YoY"
        sentiment="positive"
        chart={
          <Sparkline
            label="Headcount, last twelve months"
            data={trend([263, 266, 271, 274, 279, 285, 289, 294, 297, 301, 306, 312])}
            tone="success"
            area={false}
            showLastPoint={false}
            width={88}
          />
        }
      />
      <Stat
        label="Time to hire"
        value="24"
        unit="days"
        delta="3 faster"
        direction="down"
        sentiment="positive"
        chart={
          <Sparkline
            label="Days to hire, last eight months"
            data={trend([31, 30, 29, 29, 27, 26, 25, 24])}
            tone="success"
            area={false}
            showLastPoint={false}
            width={88}
          />
        }
      />
    </AutoGrid>
  ),
};

export const InANarrowColumn: Story = {
  name: 'In a narrow column',
  render: () => (
    <View className="gap-2.5">
      <Stat label="Headcount" value="312" direction="up" delta="+12" sentiment="positive" size={28} />
      <Stat
        label="Leavers"
        value="4"
        delta={'−2'}
        direction="down"
        sentiment="positive"
        size={28}
      />
    </View>
  ),
};
