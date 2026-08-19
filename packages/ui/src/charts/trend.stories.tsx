import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';

import { Button } from '../components/button/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import { Sparkline, TrendChart } from '../components/chart/chart';
import { AutoGrid } from '../components/layout/layout';
import { Stat } from '../components/stat/stat';
import { headcount, leavers } from './fixtures';

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
    series: [{ label: 'Headcount', data: headcount, tone: 'accent' }],
    height: 220,
    area: false,
  },
} satisfies Meta<typeof TrendChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Headcount</CardTitle>
      </CardHeader>
      <CardContent>
        <TrendChart {...args} />
      </CardContent>
    </Card>
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
  render: (args) => (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Line</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart {...args} area={false} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Area</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart {...args} area />
        </CardContent>
      </Card>
    </div>
  ),
};

export const TwoSeries: Story = {
  name: 'Two series',
  args: {
    label: 'Headcount and leavers, February to August 2026',
    series: [
      { label: 'Headcount', data: headcount, tone: 'accent' },
      { label: 'Leavers', data: leavers, tone: 'danger' },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Two series on one axis only works when they share a scale. These do not. 912 against 6, so the leavers line sits flat along the bottom and says nothing. This story is the argument for the next one.',
      },
    },
  },
  render: (args) => (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>One axis, two very different scales</CardTitle>
      </CardHeader>
      <CardContent>
        <TrendChart {...args} />
      </CardContent>
    </Card>
  ),
};

export const SmallMultiples: Story = {
  name: 'Small multiples',
  parameters: {
    docs: {
      description: {
        story:
          'The fix for series that do not share a scale, and the fix for three or more of anything: one chart each, same width, same period, stacked so the eye can travel down them. A second y-axis would have been the other option, and a dual-axis chart can be made to show any correlation you like by choosing the scales, which is why this system does not offer one.',
      },
    },
  },
  render: () => (
    <div className="max-w-3xl space-y-4">
      {(
        [
          ['Headcount', headcount, 'accent'],
          ['Leavers', leavers, 'danger'],
        ] as const
      ).map(([title, data, tone]) => (
        <Card key={title}>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              label={`${title}, February to August 2026`}
              height={120}
              area
              series={[{ label: title, data: [...data], tone }]}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  ),
};

export const Sparklines: Story = {
  name: 'Sparklines',
  parameters: {
    docs: {
      description: {
        story:
          'No axes, no gridlines, sized for a stat tile. The sparkline exists for exactly this: a direction under a number, in a tile that might be 200px wide or 400px. A delta says where it moved; a sparkline says how it got there, which matters when a number is flat month-on-month after a spike and a recovery.',
      },
    },
  },
  render: () => (
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
            area={false}
            data={[
              { label: 'Feb', value: 3.1 },
              { label: 'Mar', value: 3.1 },
              { label: 'Apr', value: 3.1 },
              { label: 'May', value: 3.1 },
              { label: 'Jun', value: 3.1 },
              { label: 'Jul', value: 3.1 },
              { label: 'Aug', value: 3.1 },
            ]}
          />
        }
      />
    </AutoGrid>
  ),
};

export const Interactive: Story = {
  name: 'Hover, click and legend toggles',
  args: {
    label: 'Headcount and leavers, February to August 2026',
    series: [
      { label: 'Headcount', data: headcount, tone: 'accent' },
      { label: 'Leavers', data: leavers, tone: 'danger' },
    ],
    area: true,
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
          'Three things to try, all of them without a mouse.',
          '',
          '**Tab across the plot.** Each period is a full-height hit column with a crosshair, a marker per series and a tooltip listing the values. Radix opens the tooltip on focus as well as on hover, so the readout is not pointer-only.',
          '',
          "**Press Enter on a column.** `onSelect` fires with the period and every visible series' value at it, the readout below updates.",
          '',
          '**Toggle a legend row.** It is an `aria-pressed` button; the hidden series keeps its colour and its place, and the y axis re-fits to what is left. Hide *Headcount* and watch the leavers line become readable, which is the whole reason this control exists on a chart whose two series share an axis but not a scale.',
        ].join('\n'),
      },
    },
  },
  render: function InteractiveStory(args) {
    const [picked, setPicked] = useState<{ label: string; values: Record<string, number> } | null>(
      null,
    );

    return (
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Headcount and leavers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <TrendChart
            {...args}
            onSelect={(selection) => {
              setPicked({ label: selection.label, values: selection.values });
            }}
          />
          <p aria-live="polite" className="text-sm text-fg-muted">
            {picked
              ? `${picked.label}, ${Object.entries(picked.values)
                  .map(([name, value]) => `${name} ${String(value)}`)
                  .join(', ')}`
              : 'Pick a period, or tab into the plot.'}
          </p>
        </CardContent>
      </Card>
    );
  },
};

export const ZoomAndPan: Story = {
  name: 'Zoom and pan',
  args: {
    label: 'Headcount, weekly',
    zoomable: true,
    area: true,
    series: [
      {
        label: 'Headcount',
        tone: 'accent',
        data: Array.from({ length: 26 }, (_, index) => ({
          label: `W${String(index + 14)}`,
          // Deterministic, with a visible dip, so zooming has something to find.
          value: 840 + index * 3 + (index > 12 && index < 18 ? -22 : 0),
        })),
      },
    ],
  },
  parameters: {
    docs: {
      description: {
        story: [
          'Twenty-six weeks. Zoom in on the dip and note what changes: the axis re-labels, the y range re-fits to the visible slice, and the range is announced in a live region. *"W26 – W31 · 6 of 26"*.',
          '',
          'Every control is a named button, so the whole interaction works from the keyboard. `window` can also be driven from outside, which is how a date filter elsewhere on the page moves the chart.',
          '',
          'The re-fitting y range is the part worth arguing about: it makes a small variation legible, and it also makes a 3% dip look dramatic. That is why the axis labels are always present, always numeric, and never abbreviated away.',
        ].join('\n'),
      },
    },
  },
  render: function ZoomStory(args) {
    const [window_, setWindow] = useState({ start: 0, end: 25 });
    return (
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Headcount, weekly</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <TrendChart {...args} window={window_} onWindowChange={setWindow} />
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['Last 6 weeks', { start: 20, end: 25 }],
                ['The dip', { start: 10, end: 19 }],
                ['Everything', { start: 0, end: 25 }],
              ] as const
            ).map(([name, next]) => (
              <Button
                key={name}
                size="sm"
                onClick={() => {
                  setWindow(next);
                }}
              >
                {name}
              </Button>
            ))}
          </div>
          <p className="text-xs text-fg-muted">
            The window is controlled here, so a date filter elsewhere on a page would move the chart
            the same way.
          </p>
        </CardContent>
      </Card>
    );
  },
};
