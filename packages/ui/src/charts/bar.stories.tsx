import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import { BarChart, HorizontalBarChart, StackedBarChart } from '../components/chart/chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/table/table';
import { byDepartment, headcount, leaveTypeByTeam, teams } from './fixtures';

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
      options: ['accent', 'success', 'warning', 'danger', 'info', 'neutral'],
      table: {
        type: { summary: 'ChartTone' },
        defaultValue: { summary: 'accent' },
        category: 'Appearance',
      },
    },
    height: {
      control: { type: 'range', min: 80, max: 400, step: 20 },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '160' },
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
    tone: 'accent',
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
  render: (args) => (
    <div className="max-w-2xl">
      <BarChart {...args} />
    </div>
  ),
};

export const WithATarget: Story = {
  name: 'With a target line',
  args: {
    label: 'Time to hire by department, days',
    data: [
      { label: 'Eng', value: 47 },
      { label: 'Sales', value: 31 },
      { label: 'Support', value: 22 },
      { label: 'People', value: 38 },
      { label: 'Finance', value: 41 },
    ],
    reference: { value: 35, label: 'Target 35d' },
    tone: 'info',
  },
  parameters: {
    docs: {
      description: {
        story:
          'A bar chart without a reference is a ranking; with one it is an assessment. Two of these are over target, and that is visible at a glance rather than by reading five numbers.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-2xl">
      <BarChart {...args} />
    </div>
  ),
};

export const Horizontal: Story = {
  name: 'Horizontal: categories',
  parameters: {
    docs: {
      description: {
        story:
          'The same data both ways. Read the labels: "Customer Support" and "People Operations" fit on the left and do not fit underneath. Sorted by default, because an unsorted ranking is just a list; `limit` caps the rows and says how many were dropped.',
      },
    },
  },
  render: () => (
    <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Horizontal</CardTitle>
        </CardHeader>
        <CardContent>
          <HorizontalBarChart label="Headcount by department" data={byDepartment} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>The same data, vertical</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart label="Headcount by department" data={byDepartment} height={200} />
        </CardContent>
      </Card>
    </div>
  ),
};

export const Stacked: Story = {
  name: 'Stacked and normalised',
  parameters: {
    docs: {
      description: {
        story:
          "The same leave data twice. On the left, absolute days. Support takes the most leave overall. On the right, normalised, and now the honest comparison is proportion, where Support's *sick* share is the thing that stands out. Each answers a different question, and neither answers both.",
      },
    },
  },
  render: () => (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Days taken</CardTitle>
        </CardHeader>
        <CardContent>
          <StackedBarChart
            label="Leave days by team and type"
            categories={[...teams]}
            series={leaveTypeByTeam}
            height={220}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Share of each team&rsquo;s leave</CardTitle>
        </CardHeader>
        <CardContent>
          <StackedBarChart
            label="Leave mix by team"
            categories={[...teams]}
            series={leaveTypeByTeam}
            height={220}
            normalise
          />
        </CardContent>
      </Card>
    </div>
  ),
};

export const Interactive: Story = {
  name: 'Selectable bars',
  parameters: {
    docs: {
      description: {
        story:
          'With `onSelect`, each bar becomes a `<button>`: tabbable, with a focus ring, announcing "Engineering: 312". Try it from the keyboard. This is why the bars are CSS rather than `<rect>` elements: a rect cannot be a button.',
      },
    },
  },
  render: function InteractiveStory() {
    const [selected, setSelected] = useState(0);
    const point = byDepartment[selected];

    return (
      <div className="max-w-2xl space-y-4">
        <HorizontalBarChart
          label="Headcount by department"
          data={byDepartment}
          sorted={false}
          selectedIndex={selected}
          onSelect={(_, index) => {
            setSelected(index);
          }}
        />
        <p aria-live="polite" className="text-sm text-fg-muted">
          {point ? (
            <>
              <span className="font-medium text-fg">{point.label}</span>, {point.value} people
            </>
          ) : null}
        </p>
        {point ? (
          <Table aria-label={`${point.label} detail`}>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead numeric>People</TableHead>
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
