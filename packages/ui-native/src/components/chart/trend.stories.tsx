import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { DAILY, HEADCOUNT, MONTH_NAMES, MONTHS, PLAN, byMonth, series } from '../../docs/charts.ts';
import { designDocs, designNote } from '../../docs/design.ts';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { ChartCard } from './parts.tsx';
import { Sparkline, TrendChart } from './trend-chart.tsx';

const meta = {
  title: 'Charts/Trend',
  component: TrendChart,
  parameters: designDocs('trend'),
  args: {
    label: 'Headcount, last 12 months',
    series: [],
  },
} satisfies Meta<typeof TrendChart>;

export default meta;
type Story = StoryObj<typeof meta>;

const months = (values: readonly number[]) => byMonth(values, false);
const lastTwelve = [
  'Oct',
  'Nov',
  'Dec',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
];

export const Playground: Story = {
  args: {
    label: 'Headcount, last 12 months',
    summary: 'Headcount grew from 263 to 312 over the last twelve months, up 18.6%.',
    series: [{ label: 'Headcount', data: series(HEADCOUNT, lastTwelve) }],
    area: true,
    showLastPoint: true,
    axisLabels: ['Oct', 'Jan', 'Apr', 'Jul', 'Sep'],
  },
  render: (args) => (
    <ChartCard title="Headcount, last 12 months" value="312" description="+18.6% year on year">
      <TrendChart {...args} />
    </ChartCard>
  ),
};

export const LineOrArea: Story = {
  name: 'Line or area',
  render: () => (
    <Stack gap={3}>
      <ChartCard title="Line · for comparing">
        <TrendChart
          label="Headcount, 2026, as a line"
          height={120}
          axisLabels={[]}
          series={[{ label: 'Headcount', data: months(HEADCOUNT) }]}
        />
      </ChartCard>
      <ChartCard title="Area · for totals">
        <TrendChart
          label="Headcount, 2026, as an area"
          height={120}
          area
          axisLabels={[]}
          series={[{ label: 'Headcount', data: months(HEADCOUNT) }]}
        />
      </ChartCard>
    </Stack>
  ),
};

export const TwoSeries: Story = {
  name: 'Two series',
  render: () => (
    <ChartCard title="Headcount vs plan" value="312">
      <TrendChart
        label="Headcount against plan, 2026"
        summary="Headcount ended the year at 312, six under the plan of 318."
        axisLabels={['Jan', 'Apr', 'Jul', 'Oct', 'Dec']}
        series={[
          { label: 'Actual', tone: 'chart-1', data: months(HEADCOUNT) },
          { label: 'Plan', tone: 'neutral', dashed: true, data: months(PLAN) },
        ]}
        showLegend
        hiddenSeries={[]}
      />
    </ChartCard>
  ),
};

const teams = [
  ['Engineering', [80, 86, 92, 98, 104, 112, 118, 124]],
  ['Sales', [48, 50, 55, 58, 60, 61, 63, 64]],
  ['Design', [20, 22, 22, 24, 25, 26, 27, 28]],
  ['Support', [40, 42, 45, 44, 46, 47, 47, 48]],
] as const;

export const SmallMultiples: Story = {
  name: 'Small multiples',
  parameters: designNote('trend', 'Small multiples'),
  render: () => (
    <View className="flex-row flex-wrap gap-2.5">
      {teams.map(([team, values], i) => (
        <View
          key={team}
          className="min-w-[160px] flex-1 basis-[40%] gap-2 rounded-m-card bg-surface p-3.5 shadow-sm"
        >
          <View className="flex-row items-center">
            <Text variant="footnote" weight="semibold" className="flex-1">
              {team}
            </Text>
            <Text weight="bold" tabular className="text-[16px] leading-none">
              {String(values.at(-1))}
            </Text>
          </View>
          <TrendChart
            label={`${team} headcount, last eight months`}
            height={60}
            plain
            area
            axisLabels={[]}
            series={[
              {
                label: team,
                tone: (['chart-1', 'chart-2', 'chart-3', 'chart-4'] as const)[i] ?? 'chart-1',
                data: series(values, MONTHS.slice(1, 9)),
              },
            ]}
          />
        </View>
      ))}
    </View>
  ),
};

const sparks = [
  ['Headcount', [263, 266, 271, 274, 279, 285, 289, 294, 297, 301, 306, 312], '312', 'success'],
  ['Attrition', [8.2, 7.9, 7.6, 7.4, 7.1, 6.8, 6.4, 6.1], '6.1%', 'success'],
  ['Open roles', [11, 12, 12, 14, 13, 15, 16, 18], '18', 'warning'],
] as const;

export const Sparklines: Story = {
  render: () => (
    <View>
      {sparks.map(([name, values, value, tone], i) => (
        <View
          key={name}
          className={`flex-row items-center gap-3 py-2.5${i < sparks.length - 1 ? ' border-b border-border' : ''}`}
        >
          <Text variant="callout" weight="medium" className="flex-1 leading-none">
            {name}
          </Text>
          <Sparkline
            label={`${name}, last ${String(values.length)} months`}
            data={values.map((v, j) => ({ label: MONTHS[j] ?? '', value: v }))}
            tone={tone}
            area={false}
            showLastPoint={false}
            width={80}
            height={28}
          />
          <Text weight="bold" tabular className="w-[52px] text-right leading-none">
            {value}
          </Text>
        </View>
      ))}
    </View>
  ),
};

export const HoverClickAndLegendToggles: Story = {
  name: 'Hover, click and legend toggles',
  parameters: designNote('trend', 'Hover, click and legend toggles'),
  render: () => (
    <ChartCard title="Headcount by site">
      <TrendChart
        label="Headcount by site, 2026"
        summary="Berlin grew fastest, from 80 to 121."
        axisLabels={['Jan', 'Apr', 'Jul', 'Oct', 'Dec']}
        defaultInspectedIndex={7}
        series={[
          {
            label: 'Berlin',
            data: series([80, 84, 88, 92, 96, 99, 104, 108, 110, 114, 118, 121], MONTH_NAMES),
          },
          {
            label: 'London',
            data: series([60, 62, 62, 65, 68, 70, 71, 74, 76, 78, 80, 82], MONTH_NAMES),
          },
          {
            label: 'Remote',
            data: series([40, 41, 44, 46, 47, 49, 52, 54, 55, 57, 58, 60], MONTH_NAMES),
          },
        ]}
        defaultHiddenSeries={['Remote']}
      />
    </ChartCard>
  ),
};

const days = DAILY.map((value, i) => {
  const date = new Date(Date.UTC(2026, 7, 1 + i));
  return {
    label: `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ''}`,
    value,
  };
});

export const ZoomAndPan: Story = {
  name: 'Zoom and pan',
  render: () => (
    <ChartCard title="Daily active users, 2026">
      <TrendChart
        label="Daily active users, August and September 2026"
        summary="Daily active users rose from 180 to about 270 over forty days."
        area
        zoomable
        brush
        defaultWindow={{ start: 21, end: 37 }}
        series={[{ label: 'Daily active users', data: days }]}
      />
    </ChartCard>
  ),
};
