import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';

import { Button } from '../components/button/button';
import { seriesTone, Sparkline, TrendChart } from '../components/chart/chart';
import { ChartCard } from '../components/chart/chart-card';
import { AutoGrid } from '../components/layout/layout';
import { headcount, headcount2026, plan2026, yearMonths } from './fixtures';

const series = (values: readonly number[]): { label: string; value: number }[] =>
  values.map((value, index) => ({ label: yearMonths[index] ?? String(index), value }));

const meta = {
  title: 'Charts/Trend',
  component: TrendChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A line over a period, with or without a fill: plus the axis-less version that lives inside a stat tile.',
          '',
          '### Line or area',
          '',
          'A fill reads as **volume**, so it is right for a headcount and wrong for a rate: an area under a percentage implies an accumulation that does not exist. It also stops working past two series, three overlapping fills is a chart nobody can read, and the answer there is small multiples rather than more transparency.',
          '',
          '### The stretched viewBox',
          '',
          'The plot is `viewBox="0 0 100 100"` with `preserveAspectRatio="none"`, so it fills any container without measuring one. That distorts strokes, which is why every line carries `vector-effect="non-scaling-stroke"`, without it the same component draws a hairline in a wide card and a fat line in a narrow one.',
          '',
          'Axis labels are HTML positioned in percentages, not SVG `<text>`. They stay on the type scale, honour the root font size, so they grow 1.5× on a television, and never end up 4px tall.',
          '',
          '### Interaction',
          '',
          'Hover or **Tab** across the plot: each period is a full-height hit column rather than a 2px line, with a crosshair, a point marker per series and a tooltip listing every value at that period. A 2px line is a coordination test; the column above it is not, and the column can take focus, which the line never could.',
          '',
          'Legend rows are `aria-pressed` buttons that switch a series off. Hidden means hidden. The series keeps its colour, stays in the legend, and stays in the accessibility table. Removing it would leave no way back.',
          '',
          '### Zoom and pan are buttons first',
          '',
          'Drag-to-select is the obvious gesture and is unreachable by a keyboard, a switch, or an unsteady hand. The primitive here is a `window` of indices plus named controls: zoom in, zoom out, step left, step right, reset, and the visible range is stated in words in a live region. A module that wants drag-to-select adds it on top and feeds the same `onWindowChange`.',
          '',
          'Zooming narrows the **period**. It does not scale the drawing: the axis re-labels and the y range re-fits to what is visible. A chart that scales its own pixels is a chart with a blurry axis.',
          '',
          '### A flat series does not collapse',
          '',
          'When every value is equal there is no span to divide by. The line is drawn through the middle rather than along the bottom, because a flat series along the axis reads as a collapse to zero.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    series: {
      description:
        'One entry per line. Two is the practical maximum before the legend does the work.',
      control: 'object',
      table: { type: { summary: 'readonly { label; tone?; data }[]' }, category: 'Data' },
    },
    label: { control: 'text', table: { type: { summary: 'string' }, category: 'Data' } },
    height: {
      control: { type: 'range', min: 100, max: 400, step: 20 },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '200' },
        category: 'Appearance',
      },
    },
    area: {
      description: 'Fills under the line. Volume, not rate: see above.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    format: {
      control: false,
      table: { type: { summary: '(value: number) => string' }, category: 'Data' },
    },
    zoomable: {
      description: 'Renders the zoom and pan controls above the plot.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Interaction',
      },
    },
    window: {
      description:
        'The visible slice, as inclusive indices. Uncontrolled when omitted. The chart keeps its own.',
      control: false,
      table: { type: { summary: '{ start: number; end: number }' }, category: 'Interaction' },
    },
    onWindowChange: {
      description: 'Fires with the new window, already clamped and never inverted.',
      control: false,
      table: { type: { summary: '(window) => void' }, category: 'Interaction' },
    },
    hiddenSeries: {
      description: 'Series switched off from the legend. Uncontrolled when omitted.',
      control: false,
      table: { type: { summary: 'readonly string[]' }, category: 'Interaction' },
    },
    onHiddenSeriesChange: {
      control: false,
      table: { type: { summary: '(hidden: readonly string[]) => void' }, category: 'Interaction' },
    },
    onSelect: {
      description: "Fires with the period and every visible series' value at it.",
      control: false,
      table: { type: { summary: '(selection) => void' }, category: 'Interaction' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Headcount, February to August 2026',
    series: [{ label: 'Headcount', data: headcount }],
    height: 220,
    area: false,
  },
} satisfies Meta<typeof TrendChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    label: 'Headcount, last 12 months',
    series: [{ label: 'Headcount', data: headcount2026 }],
    area: true,
    showLastPoint: true,
  },
  render: (args) => (
    <ChartCard title="Headcount, last 12 months" value="312" description="+18.6% year on year">
      <TrendChart {...args} />
    </ChartCard>
  ),
};

export const LineOrArea: Story = {
  name: 'Line or area',
  parameters: {
    docs: {
      description: {
        story:
          'The same headcount both ways. The fill helps here because headcount *is* a volume. Put the same fill under an attrition rate and it implies an accumulating quantity, which is a claim the data does not make.',
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth="16.25rem" gap={3}>
      <ChartCard title="Line · for comparing">
        <TrendChart
          label="Headcount, line"
          height={120}
          series={[{ label: 'Headcount', data: headcount2026 }]}
        />
      </ChartCard>
      <ChartCard title="Area · for totals">
        <TrendChart
          label="Headcount, area"
          height={120}
          area
          series={[{ label: 'Headcount', data: headcount2026 }]}
        />
      </ChartCard>
    </AutoGrid>
  ),
};

export const TwoSeries: Story = {
  name: 'Two series',
  args: {
    label: 'Headcount against plan, 2026',
    series: [
      { label: 'Actual', data: headcount2026 },
      { label: 'Plan', data: plan2026, tone: 'neutral', dashed: true },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'The line is the data and the dashed line is the plan. Nothing else. A plan is drawn in the quiet neutral and dashed, never filled, so the eye reads it as a reference rather than a second measurement.',
      },
    },
  },
  render: (args) => (
    <ChartCard title="Headcount vs plan" value="312">
      <TrendChart {...args} />
    </ChartCard>
  ),
};

const multiples = [
  ['Engineering', [80, 86, 92, 98, 104, 112, 118, 124]],
  ['Sales', [48, 50, 55, 58, 60, 61, 63, 64]],
  ['Design', [20, 22, 22, 24, 25, 26, 27, 28]],
  ['Support', [40, 42, 45, 44, 46, 47, 47, 48]],
] as const;

export const SmallMultiples: Story = {
  name: 'Small multiples',
  parameters: {
    docs: {
      description: {
        story:
          'Same scale, same size, one per team. Easier to compare than four lines on one chart, and the fix for series that do not share a scale: a second y axis can be made to show any correlation you like by choosing the scales.',
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth="10rem" gap={3}>
      {multiples.map(([team, values], index) => (
        <ChartCard key={team} title={team} value={String(values.at(-1))}>
          <Sparkline
            label={`${team} headcount, last 8 months`}
            tone={seriesTone(index)}
            showLastPoint={false}
            data={values.map((value, month) => ({
              label: yearMonths[month] ?? String(month),
              value,
            }))}
          />
        </ChartCard>
      ))}
    </AutoGrid>
  ),
};

const sparkRows = [
  ['Headcount', headcount2026.map((point) => point.value), '312', 'success'],
  ['Attrition', [8.2, 7.9, 7.6, 7.4, 7.1, 6.8, 6.4, 6.1], '6.1%', 'success'],
  ['Open roles', [11, 12, 12, 14, 13, 15, 16, 18], '18', 'warning'],
] as const;

export const Sparklines: Story = {
  name: 'Sparklines',
  parameters: {
    docs: {
      description: {
        story:
          'No axes and no gridlines: a direction beside a number. A delta says where it moved; a sparkline says how it got there, which matters when a number is flat month on month after a spike and a recovery. The colour carries the verdict, good or watch, and the number beside it carries the fact.',
      },
    },
  },
  render: () => (
    <ul className="max-w-md divide-y divide-border">
      {sparkRows.map(([name, values, figure, tone]) => (
        <li key={name} className="flex items-center gap-3 py-2.5">
          <span className="flex-1 text-sm font-medium touch:text-base">{name}</span>
          <Sparkline
            label={`${name}, last ${String(values.length)} months`}
            tone={tone}
            area={false}
            showLastPoint={false}
            className="w-20"
            data={values.map((value, month) => ({
              label: yearMonths[month] ?? String(month),
              value,
            }))}
          />
          <span className="w-13 text-end font-bold tabular-nums">{figure}</span>
        </li>
      ))}
    </ul>
  ),
};

export const Interactive: Story = {
  name: 'Hover, click and legend toggles',
  args: {
    label: 'Headcount by site, 2026',
    series: [
      {
        label: 'Berlin',
        data: series([80, 84, 88, 92, 96, 99, 104, 108, 110, 114, 118, 121]),
      },
      {
        label: 'London',
        data: series([60, 62, 62, 65, 68, 70, 71, 74, 76, 78, 80, 82]),
      },
      {
        label: 'Remote',
        data: series([40, 41, 44, 46, 47, 49, 52, 54, 55, 57, 58, 60]),
      },
    ],
    // Spies, so the **Actions** panel shows what the callback is handed and
    // when, the fastest answer to the question people actually have about a
    // chart's API.
    onSelect: fn(),
    onWindowChange: fn(),
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Click a legend item to hide that series. The hidden one is struck through, and the axis rescales.',
          '',
          '**Tab across the plot.** Each period is a full-height hit column with a crosshair, a marker per series and a tooltip listing the values, opened by focus as well as hover. **Press Enter on a column** and `onSelect` fires with the period and every visible value at it.',
        ].join('\n'),
      },
    },
  },
  render: function InteractiveStory(args) {
    const [hidden, setHidden] = useState<readonly string[]>(['Remote']);
    const [picked, setPicked] = useState<{ label: string; values: Record<string, number> } | null>(
      null,
    );

    return (
      <ChartCard title="Headcount by site">
        <TrendChart
          {...args}
          hiddenSeries={hidden}
          onHiddenSeriesChange={setHidden}
          onSelect={(selection) => {
            setPicked({ label: selection.label, values: selection.values });
          }}
        />
        <p aria-live="polite" className="mt-3 text-sm text-fg-muted">
          {picked
            ? `${picked.label}: ${Object.entries(picked.values)
                .map(([name, value]) => `${name} ${String(value)}`)
                .join(' · ')}`
            : 'Pick a period, or tab into the plot.'}
        </p>
      </ChartCard>
    );
  },
};

export const ZoomAndPan: Story = {
  name: 'Zoom and pan',
  args: {
    label: 'Daily active users, August and September 2026',
    zoomable: true,
    brush: true,
    area: true,
    series: [
      {
        label: 'Daily active users',
        data: Array.from({ length: 40 }, (_, index) => ({
          label: `D${String(index + 1)}`,
          // Deterministic, with a visible wave, so zooming has something to find.
          value: 180 + Math.round(Math.sin(index / 3) * 18 + index * 2.2),
        })),
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Zoom in and note what changes: the axis re-labels, the y range re-fits to the visible slice, and the range is announced in a live region.',
          '',
          'Every control is a named button, so the whole interaction works from the keyboard. `window` can also be driven from outside, which is how a date filter elsewhere on the page moves the chart.',
          '',
          '`brush` adds the overview strip underneath: the whole series, with the window drawn over it. Drag an edge to resize, drag the window to pan, or drag on the bare strip to draw a new range. The edges and the window are sliders too: arrows step a day, Page Up and Page Down a tenth, Home and End run to the ends.',
        ].join('\n'),
      },
    },
  },
  render: function ZoomStory(args) {
    const [window_, setWindow] = useState({ start: 22, end: 37 });
    return (
      <ChartCard
        title="Daily active users, 2026"
        action={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setWindow({ start: 0, end: 39 });
            }}
          >
            Reset
          </Button>
        }
      >
        <TrendChart {...args} window={window_} onWindowChange={setWindow} />
      </ChartCard>
    );
  },
};
