import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native-css/components';

import { HEADCOUNT, MONTHS, PLAN, TEAMS, series } from '../../docs/charts.ts';
import { designDocs } from '../../docs/design.ts';
import { Stack } from '../layout/layout.tsx';
import { Stat } from '../stat/stat.tsx';
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

export const PeopleDashboard: Story = {
  name: 'People dashboard',
  render: () => (
    <Stack gap={3}>
      <Stack gap={3}>
        <Stat
          label="Headcount"
          value="312"
          delta="+12"
          direction="up"
          sentiment="positive"
          chart={
            <Sparkline
              label="Headcount, last seven months"
              data={[280, 286, 290, 297, 301, 306, 312].map((v, i) => ({
                label: MONTHS[i + 2] ?? '',
                value: v,
              }))}
              tone="success"
              area={false}
              showLastPoint={false}
              width={64}
              height={32}
            />
          }
        />
        <Stat
          label="Attrition"
          value="6.1"
          unit="%"
          delta={'\u22120.8 pts'}
          direction="down"
          sentiment="positive"
        />
        <Stat label="Open roles" value="18" direction="up" delta="+4" sentiment="negative" />
        <Stat label="eNPS" value="34" direction="up" delta="+6" sentiment="positive" />
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
