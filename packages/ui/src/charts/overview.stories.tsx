import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import {
  BarChart,
  DonutChart,
  FunnelChart,
  HeatmapChart,
  HorizontalBarChart,
  Sparkline,
  TrendChart,
} from '../components/chart/chart';
import { ChartCard } from '../components/chart/chart-card';
import { WaterfallChart } from '../components/chart/waterfall-chart';
import { AutoGrid } from '../components/layout/layout';
import {
  absence,
  byDepartment,
  headcount2026,
  hires2026,
  leaveByWeekday,
  pipeline,
} from './fixtures';

const meta = {
  title: 'Charts/Overview',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Every chart in Reach is drawn by hand in SVG and CSS, and sits in a `ChartCard`: the title first and quiet, the number large, the chart under it. Series take the `chart-1` to `chart-6` palette in order.',
          '',
          '### Why no charting library',
          '',
          'These are the shapes an HRIS actually uses. Every library that draws them arrives with its own colour system, its own tooltip, its own focus behaviour and 60–150 kB: after which the design system has two sources of truth for a colour and none for a focus ring. When a module needs something genuinely analytical, a distribution, a cohort matrix, a Gantt. That is a *module* dependency, not a system one.',
          '',
          '### Every chart renders its numbers twice',
          '',
          'Once as SVG or CSS, and once as a real `<table>` in the accessibility tree. An `aria-label` reading "line chart of headcount" tells a blind user only that they are missing something; the table tells them what. Turn on a screen reader and tab through any chart on this page, the data is all there. That is why every `data` prop carries a `label` rather than bare numbers.',
          '',
          '### Choosing one',
          '',
          '| Chart | The question it answers |',
          '| --- | --- |',
          '| `Sparkline` | Which way has this number been going? (inside a stat tile) |',
          '| `BarChart` | How do these **periods** compare? |',
          '| `HorizontalBarChart` | How do these **categories** rank? |',
          '| `StackedBarChart` | What is each category made of? |',
          '| `TrendChart` | How have one or two series moved, with values readable off an axis? |',
          '| `DonutChart` | What is this whole made of? Five slices maximum. |',
          '| `HeatmapChart` | Where is the density, across two dimensions? |',
          '| `FunnelChart` | Where do people drop out of a sequence? |',
          '| `TimelineChart` | What happens when, and to whom? A Gantt. |',
          '| `OrgChart` | Who reports to whom? |',
          '| `ComboChart` | How do two measures in different units move together? |',
          '| `StackedAreaChart` | How does a total change over time, and what makes it up? |',
          '| `Gauge` | How close are we to one target? |',
          '| `BulletChart` | How close are we to several targets, in little space? |',
          '| `RadarChart` | How does one thing compare across five to eight qualities? |',
          '| `TreemapChart` | What is this whole made of, when there are too many parts for a donut? |',
          '| `HistogramChart` | How are these values spread? |',
          '| `CohortChart` | How does each group of joiners stay over time? |',
          '| `CalendarHeatmap` | Which days were busy, across months? |',
          '| `BubbleChart` | How do these compare on two measures, sized by a third? |',
          '',
          '### Interaction, on every chart',
          '',
          'There is one prop shape for all of them, `ChartInteractionProps`, so `zoomable` means the same thing on a bar chart as on a heatmap. A screen that swaps one chart for another does not have to relearn its props.',
          '',
          '| | |',
          '| --- | --- |',
          '| **Hover and focus** | Every mark has a tooltip, opened by focus as well as by pointer. |',
          '| **Click** | `onSelect` on every chart, with the mark as a real button. |',
          '| **Zoom** | Buttons **and** drag-to-select across the plot. `window` is a pair of indices, controlled or not. |',
          '| **Right-click** | Zoom in, zoom out, reset, copy as CSV, plus whatever the caller adds. |',
          '',
          'Drag comes second, deliberately. A drag is unreachable by a keyboard, a switch, or an unsteady hand, so the buttons are the primitive and the marquee is the accelerator, never the only way. Nothing happens until the pointer moves 6px, so a click on a bar is still a click on a bar, and the click that follows a real drag is swallowed.',
          '',
          'The donut has no `zoomable`. It has no axis and no order, so a zoom would have to mean "hide some slices", which the legend already does, and a total that silently excludes what you zoomed past is a chart that lies.',
          '',
          '### Rules that hold for all of them',
          '',
          '- **Colour is never the only channel.** Every legend prints the value beside the label; every heatmap cell carries a description; every tone has a word next to it.',
          '- **Nothing is measured in JavaScript.** Bars are percentage widths and heights, lines are a stretched `viewBox` with `vector-effect="non-scaling-stroke"`. A chart that needs a `ResizeObserver` to be correct is a chart that is wrong for one frame on every resize.',
          '- **Axis labels are HTML, not SVG `<text>`.** They stay on the type scale, honour the root font size, so they grow on a television, and never end up 4px tall in a wide container.',
          '- **A zero is not an absence.** Every bar has a `max(…, 2px)` floor, because "none" and "no data" mean very different things and must not look identical.',
          '- **Zooming never hides data from a screen reader.** The window changes what is drawn; the accessibility table always carries the whole series.',
          '- **Copy as CSV quotes every field** and prefixes a leading `=`, `+`, `-` or `@`, the injection case that turns an export into code execution in Excel.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const contract = [
  ['Title and summary', 'Read first: "82 hires in 2026. The most was 14 in September."'],
  ['Data table', 'A visually hidden table carries every value.'],
  ['Keyboard', 'Tab into the chart; every mark takes focus and opens its readout.'],
  ['Colour', 'Never the only signal. Labels, values and a table carry it too.'],
] as const;

export const Gallery: Story = {
  name: 'Every chart',
  parameters: {
    docs: {
      description: {
        story:
          'One card per chart type, at the size a dashboard tile gives them. The number comes first and the chart under it, and every series takes the palette in order. Resize the canvas: none of them measures anything in JavaScript, so every one reflows with its card.',
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth="16.25rem" gap={3}>
      <ChartCard title="Bar">
        <BarChart
          label="Hires by month, January to September"
          data={hires2026.slice(0, 9)}
          height={90}
          highlightIndex={8}
        />
      </ChartCard>
      <ChartCard title="Trend">
        <TrendChart
          label="Headcount, 2026"
          height={90}
          area
          series={[{ label: 'Headcount', data: headcount2026 }]}
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
          rows={leaveByWeekday.rows.slice(0, 3)}
          columns={leaveByWeekday.columns.slice(0, 5)}
          cells={leaveByWeekday.cells}
        />
      </ChartCard>
      <ChartCard title="Funnel">
        <FunnelChart
          label="Hiring funnel"
          showConversion={false}
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
          baseline="zero"
          data={[
            { label: 'Start', value: 297, total: true },
            { label: 'In', value: 18 },
            { label: 'Out', value: -3 },
            { label: 'End', value: 312, total: true },
          ]}
        />
      </ChartCard>
    </AutoGrid>
  ),
};

export const Accessibility: Story = {
  name: 'The accessibility contract',
  parameters: {
    docs: {
      description: {
        story: [
          'Every chart renders its numbers twice. The second copy is a real `<table>`, visually hidden and fully present in the accessibility tree: headers, row scope and all. Every chart is also a named `figure`, and takes a `summary` sentence that is read before the table, so a screen reader hears the point before the numbers.',
          '',
          'What that rules out is worth stating. A chart cannot be described adequately by an `aria-label` alone, because a summary is not the data. It also cannot rely on a tooltip, because a tooltip needs a pointer.',
        ].join('\n'),
      },
    },
  },
  render: () => (
    <div className="flex flex-col gap-3.5">
      <ChartCard title="Hires, 2026" value="82">
        <BarChart
          label="Hires by month, 2026"
          summary="82 hires in 2026. The most was 14 in September."
          data={hires2026}
          highlightIndex={8}
          futureFrom={9}
          height={150}
        />
      </ChartCard>
      <dl className="grid gap-x-6 gap-y-3 text-sm [grid-template-columns:minmax(0,10.5rem)_minmax(0,1fr)] touch:grid-cols-1 touch:gap-y-1">
        {contract.map(([term, detail]) => (
          <div key={term} className="contents">
            <dt className="font-medium text-fg-muted touch:mt-2">{term}</dt>
            <dd className="text-fg">{detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  ),
};

export const Responsive: Story = {
  name: 'At every width',
  parameters: {
    docs: {
      description: {
        story:
          'Wide, medium and narrow. As the card narrows the labels thin out, and at its narrowest the card keeps the number and a sparkline: past a certain width a chart stops being a chart, and the number is what is left worth reading.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-stretch gap-3">
      <div className="min-w-0 flex-[3_1_22.5rem]">
        <ChartCard title="Wide" className="h-full">
          <BarChart label="Hires by month" data={hires2026} height={120} highlightIndex={8} />
        </ChartCard>
      </div>
      <div className="min-w-0 flex-[2_1_13.75rem]">
        <ChartCard title="Medium · labels thin out" className="h-full">
          <BarChart
            label="Hires, every other month"
            data={hires2026.filter((_, index) => index % 2 === 0)}
            height={120}
          />
        </ChartCard>
      </div>
      <div className="min-w-0 flex-[1_1_8.75rem]">
        <ChartCard title="Narrow · number only" value="82" className="h-full">
          <Sparkline label="Hires, January to September" data={hires2026.slice(0, 9)} />
        </ChartCard>
      </div>
    </div>
  ),
};

export const Interaction: Story = {
  name: 'Zoom, drag and right-click',
  parameters: {
    docs: {
      description: {
        story: [
          'The same interaction surface on every axis chart:',
          '',
          '- **Drag across the plot** to zoom into the range you dragged. Vertical charts drag sideways, the ranking and the funnel drag down their rows.',
          '- **Use the buttons** for the same thing without a pointer, and read the window in the live region beside them.',
          '- **Drag the strip** under the trend: its edges resize the window, its body pans it, and a drag on the bare strip draws a new one. Each part is a slider, so the arrow keys do the same.',
          '- **Right-click anywhere** on a chart for zoom, reset, and copy as CSV.',
          '',
          'Nothing happens under 6px of movement, so a click on a bar is still a click on a bar, and the click that follows a real drag is swallowed.',
        ].join('\n'),
      },
    },
  },
  render: function InteractionStory() {
    const [log, setLog] = useState<string | null>(null);

    return (
      <div className="space-y-3">
        <p aria-live="polite" className="min-h-5 text-sm text-fg-muted">
          {log ?? 'Drag across a plot, or right-click one.'}
        </p>

        <AutoGrid minItemWidth="21rem" gap={3}>
          <ChartCard title="Headcount" value="312">
            <TrendChart
              label="Headcount, 2026"
              area
              zoomable
              brush
              series={[{ label: 'Headcount', data: headcount2026 }]}
              onSelect={(selection) => {
                setLog(`Trend: ${selection.label}`);
              }}
            />
          </ChartCard>

          <ChartCard title="Hires by month">
            <BarChart
              label="Hires by month"
              data={hires2026.slice(0, 9)}
              zoomable
              onSelect={(point) => {
                setLog(`Bar: ${point.label}, ${String(point.value)}`);
              }}
            />
          </ChartCard>

          <ChartCard title="Headcount by department">
            <HorizontalBarChart
              label="Headcount by department"
              data={byDepartment}
              zoomable
              onSelect={(point) => {
                setLog(`Ranking: ${point.label}, ${String(point.value)}`);
              }}
            />
          </ChartCard>

          <ChartCard title="Hiring pipeline">
            <FunnelChart
              label="Hiring pipeline"
              data={pipeline}
              zoomable
              onSelect={(stage) => {
                setLog(`Funnel: ${stage.label}, ${String(stage.value)}`);
              }}
            />
          </ChartCard>
        </AutoGrid>

        <ChartCard title="Absence by week">
          <HeatmapChart
            label="Absence days by person and week"
            rows={absence.people}
            columns={absence.weeks}
            cells={absence.cells}
            tone="warning"
            zoomable
            onSelect={(cell) => {
              setLog(`Heatmap: ${cell.row}, ${cell.column}, ${String(cell.value)}`);
            }}
          />
        </ChartCard>
      </div>
    );
  },
};
