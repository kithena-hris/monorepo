import type { Meta, StoryObj } from '@storybook/react-vite';

import { DonutChart, Sparkline, TrendChart } from '../components/chart/chart';
import { ChartCard } from '../components/chart/chart-card';
import { Gauge } from '../components/chart/gauge';
import { AutoGrid } from '../components/layout/layout';
import { Stat } from '../components/stat/stat';
import { headcount2026, plan2026, teamHeadcount } from './fixtures';

const meta = {
  title: 'Charts/KPI dashboard',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'How charts combine on one screen: **numbers first, one hero chart, and supporting charts in a grid.**',
          '',
          '- The stat tiles answer "how are we doing" before anyone reads an axis. Each carries its delta and says whether the direction is good, because down is good for attrition and bad for headcount.',
          '- One chart gets the full width: the one question the page exists to answer. Here, headcount against plan.',
          '- Supporting charts share a row at equal size, and every grid is sized by its container, never the window, so the same page is a column on a phone.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const PeopleDashboard: Story = {
  name: 'People dashboard',
  render: () => (
    <div className="flex flex-col gap-3">
      <AutoGrid minItemWidth="11rem" gap={3}>
        <Stat
          label="Headcount"
          value="312"
          delta="+12"
          deltaLabel="this quarter"
          direction="up"
          sentiment="positive"
          chart={<Sparkline label="Headcount, last 7 months" data={headcount2026.slice(5)} />}
        />
        <Stat
          label="Attrition"
          value="6.1%"
          delta="−0.8 pts"
          deltaLabel="vs last year"
          direction="down"
          sentiment="positive"
        />
        <Stat
          label="Open roles"
          value="18"
          delta="+4"
          deltaLabel="this month"
          direction="up"
          sentiment="negative"
        />
        <Stat
          label="eNPS"
          value="34"
          delta="+6"
          deltaLabel="vs last survey"
          direction="up"
          sentiment="positive"
        />
      </AutoGrid>

      <ChartCard title="Headcount vs plan" value="312">
        <TrendChart
          label="Headcount against plan, 2026"
          summary="Headcount reached 312 in December, six short of the plan of 318."
          series={[
            { label: 'Actual', data: headcount2026 },
            { label: 'Plan', data: plan2026, tone: 'neutral', dashed: true },
          ]}
        />
      </ChartCard>

      <AutoGrid minItemWidth="17.5rem" gap={3}>
        <ChartCard title="Training">
          <div className="flex justify-center">
            <Gauge value={81} label="Training complete" description="complete" size={150} />
          </div>
        </ChartCard>
        <ChartCard title="By team">
          <DonutChart
            label="Headcount by team"
            size={110}
            data={[
              ...teamHeadcount.slice(0, 3),
              {
                label: 'Other',
                value: teamHeadcount.slice(3).reduce((sum, team) => sum + team.value, 0),
              },
            ]}
          />
        </ChartCard>
      </AutoGrid>
    </div>
  ),
};
