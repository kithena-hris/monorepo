import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { HEADCOUNT, HIRES, MONTHS, byMonth, series } from '../../docs/charts.ts';
import { designDocs, designNote } from '../../docs/design.ts';
import { settled } from '../../docs/stage.tsx';
import { Stack } from '../layout/layout.tsx';
import { Text } from '../text/text.tsx';
import { BarChart } from './bar-chart.tsx';
import { DonutChart, FunnelChart, HeatmapChart } from './distribution-chart.tsx';
import { WaterfallChart } from './movement-chart.tsx';
import { ChartCard } from './parts.tsx';
import { Sparkline, TrendChart } from './trend-chart.tsx';

const meta = {
  title: 'Charts/Overview',
  parameters: designDocs('charts-overview'),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const heat = [
  [1, 3, 5, 2, 4],
  [2, 6, 8, 4, 1],
  [0, 2, 4, 7, 3],
];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export const EveryChart: Story = {
  name: 'Every chart',
  render: () => (
    <Stack gap={3}>
      <ChartCard title="Bar">
        <BarChart
          label="Hires by month, January to September"
          data={byMonth(HIRES.slice(0, 9))}
          height={90}
          highlightIndex={8}
        />
      </ChartCard>
      <ChartCard title="Trend">
        <TrendChart
          label="Headcount, 2026"
          height={90}
          area
          axisLabels={[]}
          series={[{ label: 'Headcount', data: series(HEADCOUNT, MONTHS) }]}
        />
      </ChartCard>
      <ChartCard title="Distribution">
        <DonutChart
          label="Headcount by team"
          size={90}
          showLegend={false}
          data={[
            { label: 'Eng', value: 124 },
            { label: 'Sales', value: 64 },
            { label: 'Support', value: 48 },
            { label: 'Other', value: 76 },
          ]}
        />
      </ChartCard>
      <ChartCard title="Heatmap">
        <HeatmapChart
          label="Leave requests by week and weekday"
          rows={['Week 1', 'Week 2', 'Week 3']}
          columns={weekdays}
          showRowLabels={false}
          columnLabel={() => ''}
          showScale={false}
          cells={heat.flatMap((row, r) =>
            row.map((value, c) => ({
              row: `Week ${String(r + 1)}`,
              column: weekdays[c] ?? '',
              value,
            })),
          )}
        />
      </ChartCard>
      <ChartCard title="Funnel">
        <FunnelChart
          label="Hiring funnel"
          data={[
            { label: 'Applied', value: 420 },
            { label: 'Screen', value: 180 },
            { label: 'Offer', value: 24 },
          ]}
        />
      </ChartCard>
      <ChartCard title="Movement">
        <WaterfallChart
          label="Headcount movement"
          height={90}
          data={[
            { label: 'Start', value: 297, total: true },
            { label: 'In', value: 18 },
            { label: 'Out', value: -3 },
            { label: 'End', value: 312, total: true },
          ]}
        />
      </ChartCard>
    </Stack>
  ),
};

const contract = [
  ['Title and summary', 'Read first: "82 hires in 2026. The most was 14 in September."'],
  ['Data table', 'A hidden table carries every value, for a screen reader.'],
  ['Touch', 'Tap a mark to hear and see its value. Long-press for the chart’s menu.'],
  ['Colour', 'Never the only signal. Labels and values carry it too.'],
] as const;

export const TheAccessibilityContract: Story = {
  name: 'The accessibility contract',
  render: () => (
    <Stack gap={4}>
      <ChartCard title="Hires, 2026" value="82">
        <BarChart
          label="Hires by month, 2026"
          summary="82 hires in 2026. The most was 14 in September."
          data={byMonth(HIRES)}
          highlightIndex={8}
          height={120}
        />
      </ChartCard>
      <View>
        {contract.map(([key, value], i) => (
          <View
            key={key}
            className={`gap-1 py-2.5${i < contract.length - 1 ? ' border-b border-border' : ''}`}
          >
            <Text variant="subhead" tone="muted">
              {key}
            </Text>
            <Text variant="subhead">{value}</Text>
          </View>
        ))}
      </View>
    </Stack>
  ),
};

export const AtEveryWidth: Story = {
  name: 'At every width',
  render: () => (
    <Stack gap={3}>
      <ChartCard title="Wide">
        <BarChart
          label="Hires by month, 2026"
          data={byMonth(HIRES)}
          height={120}
          highlightIndex={8}
        />
      </ChartCard>
      <ChartCard title="Medium · labels thin out">
        <BarChart
          label="Hires, every other month"
          data={byMonth(HIRES).filter((_, i) => i % 2 === 0)}
          height={120}
        />
      </ChartCard>
      <View className="w-[160px]">
        <ChartCard title="Narrow · number only" value="82">
          <Sparkline
            label="Hires, January to September"
            data={byMonth(HIRES.slice(0, 9))}
            area={false}
            showLastPoint={false}
            width={120}
            height={36}
          />
        </ChartCard>
      </View>
    </Stack>
  ),
};

function ZoomDragAndMenu(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    // Room under the chart for the menu the long-press opens there.
    <View style={{ minHeight: 720 }}>
      <ChartCard title="Headcount" value="312">
        <TrendChart
          label="Headcount, 2026"
          summary="Headcount grew every month, from 263 to 312."
          area
          brush
          zoomable
          defaultWindow={{ start: 5, end: 10 }}
          axisLabels={['Jun', 'Aug', 'Nov']}
          series={[{ label: 'Headcount', data: series(HEADCOUNT, MONTHS) }]}
          menuOpen={open}
          onMenuOpenChange={setOpen}
        />
      </ChartCard>
    </View>
  );
}

export const ZoomDragAndRightClick: Story = {
  name: 'Zoom, drag and right-click',
  parameters: designNote('charts-overview', 'Zoom, drag and right-click'),
  play: settled,
  render: () => <ZoomDragAndMenu />,
};
