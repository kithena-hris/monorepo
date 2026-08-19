import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type JSX } from 'react';

import { Badge } from '../components/badge/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import {
  BarChart,
  DonutChart,
  FunnelChart,
  HeatmapChart,
  HorizontalBarChart,
  Sparkline,
  StackedBarChart,
  TrendChart,
} from '../components/chart/chart';
import { AutoGrid } from '../components/layout/layout';
import { Money } from '../components/money/money';
import { Stat } from '../components/stat/stat';
import {
  absence,
  byDepartment,
  byStatus,
  headcount,
  leaveTypeByTeam,
  leavers,
  pipeline,
  teams,
} from './fixtures';

const meta = {
  title: 'Charts/Overview',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Eight chart types, drawn by hand in SVG and CSS.',
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

function Panel({ title, children }: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export const Gallery: Story = {
  name: 'Every chart',
  parameters: {
    docs: {
      description: {
        story:
          'All eight, on the same data set, at the sizes they are actually used. Resize the canvas: none of them measures anything in JavaScript, so every one reflows with its container.',
      },
    },
  },
  render: () => (
    <div className="space-y-6">
      <AutoGrid minItemWidth="15rem" gap={4}>
        <Stat
          label="Headcount"
          value="912"
          delta="+8.3%"
          deltaLabel="vs February"
          direction="up"
          sentiment="positive"
          chart={<Sparkline label="Headcount, last 7 months" data={headcount} />}
        />
        <Stat
          label="Leavers"
          value="6"
          delta="−1"
          deltaLabel="vs July"
          direction="down"
          sentiment="positive"
          chart={<Sparkline label="Leavers by month" data={leavers} tone="success" />}
        />
        <Stat
          label="Monthly payroll"
          value={<Money minorUnits="98345000" currency="EUR" locale="en-IE" />}
          delta="+2.1%"
          deltaLabel="vs July"
          direction="up"
          sentiment="neutral"
        />
        <Stat
          label="Offer acceptance"
          value="75%"
          delta="−9pp"
          deltaLabel="vs Q1"
          direction="down"
          sentiment="negative"
        />
      </AutoGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Headcount and leavers">
          <TrendChart
            label="Headcount and leavers, February to August 2026"
            height={200}
            area
            series={[
              { label: 'Headcount', data: headcount, tone: 'accent' },
              { label: 'Leavers', data: leavers, tone: 'danger' },
            ]}
          />
        </Panel>

        <Panel title="Headcount by month">
          <BarChart label="Headcount by month" data={headcount} height={200} showValues />
        </Panel>

        <Panel title="By department">
          <HorizontalBarChart label="Headcount by department" data={byDepartment} />
        </Panel>

        <Panel title="By status">
          <DonutChart
            label="Employees by status"
            size={150}
            data={byStatus}
            center={
              <div>
                <p className="text-xl font-semibold tabular-nums text-fg">912</p>
                <p className="text-2xs text-fg-subtle">people</p>
              </div>
            }
          />
        </Panel>

        <Panel title="Leave taken by team">
          <StackedBarChart
            label="Leave days by team and type"
            categories={[...teams]}
            series={leaveTypeByTeam}
            height={180}
          />
        </Panel>

        <Panel title="Hiring pipeline">
          <FunnelChart label="Hiring pipeline, 2026" data={pipeline} />
        </Panel>
      </div>

      <Panel title="Absence by week">
        <HeatmapChart
          label="Absence days by person and week"
          rows={absence.people}
          columns={absence.weeks}
          cells={absence.cells}
          tone="warning"
          describe={(value, row, column) =>
            value === 0
              ? `${row}, ${column}: no absence`
              : `${row}, ${column}: ${String(value)} days`
          }
        />
      </Panel>
    </div>
  ),
};

export const Accessibility: Story = {
  name: 'The accessibility contract',
  parameters: {
    docs: {
      description: {
        story: [
          'Every chart on this page renders its numbers twice. The second copy is a real `<table>`, visually hidden and fully present in the accessibility tree: headers, row scope and all.',
          '',
          'The table below is the same one the bar chart beside it emits, made visible. It is not a fallback and not a "text alternative" in the box-ticking sense: it is the data, in the one form that works for everybody.',
          '',
          'What that rules out is worth stating. A chart cannot be described adequately by an `aria-label`, because a summary is not the data, "line chart showing headcount rising" is a conclusion someone else reached. It also cannot rely on a tooltip, because a tooltip needs a pointer.',
        ].join('\n'),
      },
    },
  },
  render: () => (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="What everyone else sees">
        <HorizontalBarChart label="Headcount by department" data={byDepartment} />
      </Panel>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>What a screen reader reads</CardTitle>
          </div>
          <Badge size="sm">Normally `sr-only`</Badge>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <caption className="mb-2 text-start text-xs text-fg-muted">
              Headcount by department
            </caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1 text-start font-medium text-fg-subtle">
                  Period
                </th>
                <th scope="col" className="py-1 text-end font-medium text-fg-subtle">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {byDepartment
                .toSorted((a, b) => b.value - a.value)
                .map((point) => (
                  <tr key={point.label} className="border-b border-border last:border-0">
                    <th scope="row" className="py-1 text-start font-normal text-fg">
                      {point.label}
                    </th>
                    <td className="py-1 text-end tabular-nums text-fg-muted">{point.value}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  ),
};

export const Responsive: Story = {
  name: 'At every width',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        story:
          'The same four charts in a 20rem sidebar, a half-width column and full width. Nothing here is measured in JavaScript: bars are percentage widths, the sparkline is a stretched `viewBox`, the donut is a fixed square whose legend wraps underneath when the row gets tight, and the heatmap scrolls rather than shrinking its cells, a 6px cell is a colour, not a datum.',
      },
    },
  },
  render: () => (
    <div className="space-y-6 bg-canvas p-4">
      {(['20rem', '36rem', '100%'] as const).map((width) => (
        <div key={width} style={{ maxWidth: width }} className="space-y-3">
          <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
            Container {width}
          </p>
          <Card padded className="space-y-5">
            <Sparkline label={`Headcount at ${width}`} data={headcount} />
            <BarChart label={`By month at ${width}`} data={headcount} height={110} />
            <HorizontalBarChart label={`By department at ${width}`} data={byDepartment} limit={4} />
            <FunnelChart label={`Pipeline at ${width}`} data={pipeline.slice(0, 4)} />
          </Card>
        </div>
      ))}
    </div>
  ),
};

export const Interaction: Story = {
  name: 'Zoom, drag and right-click',
  parameters: {
    docs: {
      description: {
        story: [
          'Four charts with the same interaction surface. On each one:',
          '',
          '- **Drag across the plot** to zoom into the range you dragged. Vertical charts drag horizontally, the ranking and the funnel drag down their rows.',
          '- **Use the buttons** for the same thing without a pointer, and read the window in the live region beside them.',
          '- **Right-click anywhere** on a chart for zoom, reset, and copy as CSV.',
          '',
          'Try dragging a *tiny* distance first: nothing happens under 6px, so a click on a bar is still a click on a bar. Then drag properly and release over a bar, it zooms without also selecting the bar underneath, because the click that follows a drag is swallowed.',
        ].join('\n'),
      },
    },
  },
  render: function InteractionStory() {
    const [log, setLog] = useState<string | null>(null);
    const weekly = Array.from({ length: 24 }, (_, index) => ({
      label: `W${String(index + 14)}`,
      value: 840 + index * 3 + (index > 11 && index < 17 ? -24 : 0),
    }));

    return (
      <div className="space-y-4">
        <p aria-live="polite" className="min-h-5 text-sm text-fg-muted">
          {log ?? 'Drag across a plot, or right-click one.'}
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Bar: drag sideways">
            <BarChart
              label="Headcount by week"
              data={weekly}
              height={180}
              zoomable
              onSelect={(point) => {
                setLog(`Bar: ${point.label}, ${String(point.value)}`);
              }}
            />
          </Panel>

          <Panel title="Trend: drag sideways">
            <TrendChart
              label="Headcount by week"
              height={180}
              area
              zoomable
              series={[{ label: 'Headcount', data: weekly, tone: 'accent' }]}
              onSelect={(selection) => {
                setLog(`Trend: ${selection.label}`);
              }}
            />
          </Panel>

          <Panel title="Ranking: drag down">
            <HorizontalBarChart
              label="Headcount by department"
              data={byDepartment}
              zoomable
              onSelect={(point) => {
                setLog(`Ranking: ${point.label}, ${String(point.value)}`);
              }}
            />
          </Panel>

          <Panel title="Funnel: drag down">
            <FunnelChart
              label="Hiring pipeline"
              data={pipeline}
              zoomable
              onSelect={(stage) => {
                setLog(`Funnel: ${stage.label}, ${String(stage.value)}`);
              }}
            />
          </Panel>
        </div>

        <Panel title="Heatmap: drag across the weeks">
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
        </Panel>
      </div>
    );
  },
};
