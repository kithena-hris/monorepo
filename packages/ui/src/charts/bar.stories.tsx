import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';

import { BarChart, HorizontalBarChart, StackedBarChart } from '../components/chart/chart';
import { ChartCard } from '../components/chart/chart-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/table/table';
import { headcount, hires2026, leavers2026, teamHeadcount } from './fixtures';

const meta = {
  title: 'Charts/Bar',
  component: BarChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Three bar charts, for three different questions.',
          '',
          '| | The question | Why this shape |',
          '| --- | --- | --- |',
          '| `BarChart` | How do these **periods** compare? | Time reads left to right. Turning it on its side costs more than it saves. |',
          '| `HorizontalBarChart` | How do these **categories** rank? | The labels are words, and words need a line. |',
          '| `StackedBarChart` | What is each category **made of**? | One column per category, segments summing to its total. |',
          '',
          '### Why horizontal, for categories',
          '',
          'Typography, not taste. A vertical bar chart puts its category labels under 60px-wide bars, where "People Operations" becomes "Peop…" or gets rotated 45°. Rotated text is around 20% slower to read. Turn the chart on its side and the label sits on a full-width line where it belongs.',
          '',
          '### What a stack can and cannot show',
          '',
          'Only the **bottom** segment shares a baseline, so only it can be compared across columns by eye: everything above floats on whatever is beneath it. That is fine for *"what is this made of"* and wrong for *"which team has the most sick leave"*. The second question wants a grouped chart, or its own chart.',
          '',
          '`normalise` turns every column into 100%, which answers *"what proportion"* and destroys *"how many"*. The absolute total is printed above each column so the destroyed fact stays on screen.',
          '',
          '### Drawn in CSS, not SVG',
          '',
          'Percentage heights and widths on real elements. The bars then reflow with the container at any width, the labels are real text that wraps and truncates like text, and each bar can be a real `<button>` when the chart is interactive, none of which is true of a `<rect>`.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    data: {
      description:
        'Each point needs a `label`. It is the axis tick *and* the accessibility row header.',
      control: 'object',
      table: { type: { summary: 'readonly ChartPoint[]' }, category: 'Data' },
    },
    label: {
      description: 'Names the chart; becomes the `<caption>` of the accessibility table.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Data' },
    },
    format: {
      description:
        'Formats for display *and* for the accessibility table. Never `toFixed` on money.',
      control: false,
      table: { type: { summary: '(value: number) => string' }, category: 'Data' },
    },
    tone: {
      control: 'select',
      options: [
        'chart-1',
        'chart-2',
        'chart-3',
        'chart-4',
        'chart-5',
        'chart-6',
        'success',
        'warning',
        'danger',
        'info',
        'neutral',
      ],
      table: {
        type: { summary: 'ChartTone' },
        defaultValue: { summary: 'chart-1' },
        category: 'Appearance',
      },
    },
    height: {
      control: { type: 'range', min: 80, max: 400, step: 20 },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '200' },
        category: 'Appearance',
      },
    },
    showValues: {
      description: 'Prints the value above each bar. Drop it once the bars get thin, it wraps.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    highlightIndex: {
      description: 'One bar in colour, the rest in a quiet tint: "this month", "the median".',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Appearance' },
    },
    futureFrom: {
      description: 'Bars from this index on are periods still to come, drawn as placeholders.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Appearance' },
    },
    reference: {
      description: 'A dashed line across the plot: a target, a budget, an average.',
      control: 'object',
      table: { type: { summary: '{ value: number; label: string }' }, category: 'Appearance' },
    },
    onSelect: {
      description: 'Makes each bar a real `<button>`. Only pass it when selecting does something.',
      control: false,
      table: { type: { summary: '(point, index) => void' }, category: 'Interaction' },
    },
    selectedIndex: {
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Interaction' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Headcount by month',
    data: headcount,
    height: 200,
    showValues: true,
    tone: 'chart-1',
    // Spies, so the **Actions** panel shows what the callback is handed and
    // when, the fastest answer to the question people actually have about a
    // chart's API.
    onSelect: fn(),
    onWindowChange: fn(),
  },
} satisfies Meta<typeof BarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = {
  name: 'Vertical: periods',
  args: {
    label: 'Hires by month, 2026',
    data: hires2026,
    showValues: false,
    highlightIndex: 8,
    futureFrom: 9,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Months read left to right. One bar is in colour to point at it, the rest sit back in a tint, and the months that have not happened yet keep their place on the axis as quiet placeholders, so a year-to-date chart still reads as a year.',
      },
    },
  },
  render: (args) => (
    <ChartCard title="Hires, 2026" value="82" description="14 in September, the most so far">
      <BarChart {...args} />
    </ChartCard>
  ),
};

export const WithATarget: Story = {
  name: 'With a target line',
  args: {
    label: 'Hires per quarter against a target of 25',
    data: [
      { label: 'Q1', value: 22 },
      { label: 'Q2', value: 30 },
      { label: 'Q3', value: 30 },
      { label: 'Q4', value: 0 },
    ],
    showValues: false,
    reference: { value: 25, label: 'Target 25' },
    warnBelowReference: true,
    futureFrom: 3,
  },
  parameters: {
    docs: {
      description: {
        story:
          'A bar chart without a reference is a ranking; with one it is an assessment. `warnBelowReference` paints the quarter that missed in the warning tone, so the miss is visible without reading four numbers.',
      },
    },
  },
  render: (args) => (
    <ChartCard title="Hires per quarter vs target" value="82 / 90" className="max-w-xl">
      <BarChart {...args} />
    </ChartCard>
  ),
};

export const Horizontal: Story = {
  name: 'Horizontal: categories',
  parameters: {
    docs: {
      description: {
        story:
          'When the categories are words, turn the chart on its side: the label sits on a full line to the left instead of being truncated under a 30px bar. Sorted by default, because an unsorted ranking is just a list; `limit` caps the rows and says how many were dropped.',
      },
    },
  },
  render: () => (
    <ChartCard title="Headcount by team" className="max-w-2xl">
      <HorizontalBarChart label="Headcount by team" data={teamHeadcount} />
    </ChartCard>
  ),
};

export const Stacked: Story = {
  name: 'Stacked and normalised',
  parameters: {
    docs: {
      description: {
        story:
          'Absolute on top: what each quarter is made of, with the total printed over each column. Normalised underneath: every column is 100%, which answers "what share" and gives up "how many". Each answers a different question, and neither answers both.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col gap-3">
      <ChartCard title="Hires by level">
        <StackedBarChart
          label="Hires by level and quarter"
          categories={['Q1', 'Q2', 'Q3', 'Q4']}
          series={[
            { label: 'Junior', values: [8, 12, 10, 0] },
            { label: 'Mid', values: [10, 12, 14, 0] },
            { label: 'Senior', values: [4, 6, 6, 0] },
          ]}
        />
      </ChartCard>
      <ChartCard title="Gender by team, normalised">
        <StackedBarChart
          label="Gender by team, as a share of each team"
          categories={['Engineering', 'Design', 'Sales']}
          series={[
            { label: 'Men', values: [62, 40, 52] },
            { label: 'Women', values: [34, 56, 46] },
            { label: 'Non-binary', values: [4, 4, 2] },
          ]}
          normalise
          format={(value) => `${String(value)}%`}
        />
      </ChartCard>
    </div>
  ),
};

export const Interactive: Story = {
  name: 'Selectable bars',
  parameters: {
    docs: {
      description: {
        story:
          'With `onSelect`, each bar becomes a `<button>`: tabbable, with a focus ring, announcing "Sep: 4". The chosen bar prints its value in a pill above it, so a click answers "how many" without a hover. Try it from the keyboard.',
      },
    },
  },
  render: function InteractiveStory() {
    const [selected, setSelected] = useState(8);
    const point = leavers2026[selected];

    return (
      <div className="flex flex-col gap-3">
        <ChartCard
          title="Leavers by month"
          value={point ? String(point.value) : undefined}
          description={point ? `${point.label} · click a bar to filter the table` : undefined}
        >
          <BarChart
            label="Leavers by month, 2026"
            data={leavers2026}
            selectedIndex={selected}
            onSelect={(_, index) => {
              setSelected(index);
            }}
          />
        </ChartCard>
        {point ? (
          <Table aria-label={`Leavers in ${point.label}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead numeric>Leavers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{point.label}</TableCell>
                <TableCell numeric>{point.value}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : null}
      </div>
    );
  },
};
