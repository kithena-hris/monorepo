import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { HEADCOUNT, MONTHS, PLAN, TEAMS, series } from '../../docs/charts.ts';
import { designDocs } from '../../docs/design.ts';
import { Card } from '../card/card.tsx';
import { Icon } from '../icon/icon.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { DonutChart } from './distribution-chart.tsx';
import { ChartCard } from './parts.tsx';
import { Gauge } from './radial-chart.tsx';
import { Sparkline, TrendChart } from './trend-chart.tsx';

const meta = {
  title: 'Charts/KPI dashboard',
  parameters: designDocs('kpi-dashboard'),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/*
 * The number tiles are composed here from Card, Text and Sparkline: the
 * library's Stat is lane D's (RMB-044), and swaps in when it lands.
 */
function Tile({
  label,
  value,
  unit,
  change,
  good,
  icon,
  trend,
}: {
  label: string;
  value: string;
  unit?: string;
  change: string;
  good: boolean;
  icon: LucideIcon;
  trend?: readonly number[];
}): React.JSX.Element {
  return (
    <Card className="gap-1.5">
      <Text variant="subhead" weight="medium" tone="muted">
        {label}
      </Text>
      <View className="flex-row flex-wrap items-end justify-between gap-2">
        <Text weight="bold" tabular className="text-[30px] leading-[1.05] tracking-[-0.9px]">
          {value}
          {unit ? (
            <Text tone="muted" className="text-[15px]">
              {` ${unit}`}
            </Text>
          ) : null}
        </Text>
        {trend ? (
          <Sparkline
            label={`${label}, last seven months`}
            data={trend.map((v, i) => ({ label: MONTHS[i + 2] ?? '', value: v }))}
            tone={good ? 'success' : 'danger'}
            area={false}
            showLastPoint={false}
            width={64}
            height={32}
          />
        ) : null}
      </View>
      <View className="flex-row items-center gap-1">
        <Icon icon={icon} size={14} tone={good ? 'success' : 'danger'} />
        <Text variant="footnote" weight="semibold" tone={good ? 'success' : 'danger'}>
          {change}
        </Text>
      </View>
    </Card>
  );
}

export const PeopleDashboard: Story = {
  name: 'People dashboard',
  render: () => (
    <Stack gap={3}>
      <Stack gap={3}>
        <Tile
          label="Headcount"
          value="312"
          change="+12"
          good
          icon={ArrowUpRight}
          trend={[280, 286, 290, 297, 301, 306, 312]}
        />
        <Tile label="Attrition" value="6.1" unit="%" change="−0.8 pts" good icon={ArrowDownRight} />
        <Tile label="Open roles" value="18" change="+4" good={false} icon={ArrowUpRight} />
        <Tile label="eNPS" value="34" change="+6" good icon={ArrowUpRight} />
      </Stack>
      <ChartCard title="Headcount vs plan" value="312">
        <TrendChart
          label="Headcount against plan, last 12 months"
          summary="Headcount is 312, six under the plan of 318."
          axisLabels={['Oct', 'Jan', 'Apr', 'Jul', 'Sep']}
          showLegend
          hiddenSeries={[]}
          series={[
            { label: 'Actual', tone: 'chart-1', data: series(HEADCOUNT, MONTHS) },
            { label: 'Plan', tone: 'neutral', dashed: true, data: series(PLAN, MONTHS) },
          ]}
        />
      </ChartCard>
      <ChartCard title="Training">
        <View className="items-center">
          <Gauge value={81} size={150} label="Training complete" />
        </View>
      </ChartCard>
      <ChartCard title="By team">
        <DonutChart label="Headcount by team" size={110} data={TEAMS.slice(0, 4)} />
      </ChartCard>
    </Stack>
  ),
};
