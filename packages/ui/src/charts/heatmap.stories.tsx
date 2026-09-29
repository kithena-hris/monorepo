import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { HeatmapChart } from '../components/chart/chart';
import { ChartCard } from '../components/chart/chart-card';
import { AutoGrid } from '../components/layout/layout';
import { absence, leaveByWeekday, yearMonths } from './fixtures';

const meta = {
  title: 'Charts/Heatmap',
  component: HeatmapChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Density over two dimensions: absence by person by week, cover by team by day, activity by hour.',
          '',
          '### One hue, varying strength',
          '',
          'Not a red-to-green ramp. A two-colour ramp encodes the value in **hue and lightness at once**, and hue is exactly the channel that fails for around 8% of men, as well as on a projector, in sunlight, and in a printed PDF. A single hue mixed into the sunken fill by value encodes it once, in the channel everybody has, and resolves against either theme.',
          '',
          '### It is a real `<table>`',
          '',
          'Not a grid of divs. Row and column headers mean a screen reader announces *"Grace Hopper, W31, 3 days"* rather than reading seventy-two numbers in sequence, and every cell also carries a `title` for the pointer. A heatmap read only by colour excludes the same people twice over.',
          '',
          '### It scrolls rather than shrinking',
          '',
          'Cells stay 24px and the grid scrolls sideways past the viewport. Shrinking them to fit is the obvious move and the wrong one: a 6px cell is a colour, not a datum, and nobody can hit it with a pointer or read it at all.',
          '',
          '### Zero is not absent',
          '',
          'An empty cell takes the sunken surface, not a pale tint of the scale, "no absence" and "the palest shade of some absence" must not look the same. The description says so in words too.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    rows: {
      description: 'Row keys, in display order. People, teams, locations.',
      control: 'object',
      table: { type: { summary: 'readonly string[]' }, category: 'Data' },
    },
    columns: {
      description: 'Column keys, in display order. Usually time.',
      control: 'object',
      table: { type: { summary: 'readonly string[]' }, category: 'Data' },
    },
    cells: {
      description: 'Sparse: a missing `{ row, column }` pair is zero.',
      control: 'object',
      table: { type: { summary: 'readonly HeatmapCell[]' }, category: 'Data' },
    },
    label: { control: 'text', table: { type: { summary: 'string' }, category: 'Data' } },
    describe: {
      description:
        'Turns a cell into its spoken description, "3 days of leave", not "3". The single most useful prop here.',
      control: false,
      table: { type: { summary: '(value, row, column) => string' }, category: 'Accessibility' },
    },
    max: {
      description: 'Upper bound of the scale. Fix it to compare two heatmaps against each other.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Appearance' },
    },
    tone: {
      control: 'select',
      options: ['chart-1', 'chart-2', 'chart-4', 'success', 'warning', 'danger', 'info', 'neutral'],
      table: {
        type: { summary: 'ChartTone' },
        defaultValue: { summary: 'chart-1' },
        category: 'Appearance',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Absence days by person and week',
    rows: absence.people,
    columns: absence.weeks,
    cells: absence.cells,
    tone: 'chart-1',
    // Spies, so the **Actions** panel shows what the callback is handed and
    // when, the fastest answer to the question people actually have about a
    // chart's API.
    onSelect: fn(),
    onWindowChange: fn(),
  },
} satisfies Meta<typeof HeatmapChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    label: 'Leave requests by week and day',
    rows: leaveByWeekday.rows,
    columns: leaveByWeekday.columns,
    cells: leaveByWeekday.cells,
  },
  render: (args) => (
    <ChartCard title="Leave requests by week and day" className="max-w-xl">
      <HeatmapChart
        {...args}
        describe={(value, row, column) =>
          value === 0
            ? `${row}, ${column}: no requests`
            : `${row}, ${column}: ${String(value)} requests`
        }
      />
    </ChartCard>
  ),
};

export const FixedScale: Story = {
  name: 'A fixed scale',
  parameters: {
    docs: {
      description: {
        story:
          'When you compare heatmaps, lock them to one scale. Without `max` each grid scales to its own largest value, so the same colour means different numbers. With `showValues` every cell carries its figure, and the ramp stops at a strength the text can still be read on.',
      },
    },
  },
  render: (args) => (
    <AutoGrid minItemWidth="13.75rem" gap={3}>
      {(
        [
          ['Engineering · max 10', leaveByWeekday.cells],
          [
            'Sales · same scale',
            leaveByWeekday.cells.map((cell) => ({ ...cell, value: Math.round(cell.value / 2) })),
          ],
        ] as const
      ).map(([title, cells]) => (
        <ChartCard key={title} title={title}>
          <HeatmapChart
            {...args}
            label={`Leave requests, ${title}`}
            rows={leaveByWeekday.rows}
            columns={leaveByWeekday.columns}
            cells={cells}
            max={10}
            showValues
          />
        </ChartCard>
      ))}
    </AutoGrid>
  ),
};

export const Tones: Story = {
  name: 'Tones',
  parameters: {
    docs: {
      description: {
        story:
          'Pick the tone from what the density *means*: danger for sick days, success for check-ins, the palette for neutral activity. It is still one hue, mixed into the sunken fill by value, and the key says which end is which.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-col gap-2">
      {(['chart-1', 'success', 'warning', 'danger'] as const).map((tone) => (
        <HeatmapChart
          {...args}
          key={tone}
          tone={tone}
          label={`Twelve months, ${tone}`}
          rows={['2026']}
          columns={yearMonths}
          cells={[1, 3, 5, 7, 9, 10, 8, 6, 4, 2, 1, 0].map((value, index) => ({
            row: '2026',
            column: yearMonths[index] ?? '',
            value,
          }))}
        />
      ))}
    </div>
  ),
};
