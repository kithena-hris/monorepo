import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import { HeatmapChart } from '../components/chart/chart';
import { absence } from './fixtures';

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
          '### One hue, varying opacity',
          '',
          'Not a red-to-green ramp. A two-colour ramp encodes the value in **hue and lightness at once**, and hue is exactly the channel that fails for around 8% of men, as well as on a projector, in sunlight, and in a printed PDF. A single hue at varying opacity encodes it once, in the channel everybody has.',
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
      options: ['accent', 'success', 'warning', 'danger', 'info', 'neutral'],
      table: {
        type: { summary: 'ChartTone' },
        defaultValue: { summary: 'accent' },
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
    tone: 'warning',
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
  render: (args) => (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle>Absence, weeks 27–38</CardTitle>
      </CardHeader>
      <CardContent>
        <HeatmapChart
          {...args}
          describe={(value, row, column) =>
            value === 0
              ? `${row}, ${column}: no absence`
              : `${row}, ${column}: ${String(value)} days of absence`
          }
        />
      </CardContent>
    </Card>
  ),
};

export const FixedScale: Story = {
  name: 'A fixed scale',
  parameters: {
    docs: {
      description: {
        story:
          'Two teams, side by side. Without `max` each grid scales to its own largest value, so the darkest cell means something different in each, and two charts that look identical describe very different weeks. Fixing the ceiling makes them comparable, at the cost of a flatter grid where the values are small.',
      },
    },
  },
  render: (args) => (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      {(['Platform', 'Support'] as const).map((team, index) => (
        <Card key={team}>
          <CardHeader>
            <CardTitle>{team}</CardTitle>
          </CardHeader>
          <CardContent>
            <HeatmapChart
              {...args}
              label={`Absence in ${team}`}
              max={5}
              rows={absence.people.slice(index * 3, index * 3 + 3)}
              columns={absence.weeks.slice(0, 8)}
              describe={(value, row, column) =>
                value === 0
                  ? `${row}, ${column}: no absence`
                  : `${row}, ${column}: ${String(value)} days`
              }
            />
          </CardContent>
        </Card>
      ))}
    </div>
  ),
};

export const Tones: Story = {
  name: 'Tones',
  parameters: {
    docs: {
      description: {
        story:
          'Pick the tone from what the density *means*: warning for absence, success for coverage, accent for neutral activity. It is still one hue, the scale is opacity, and the legend says which end is which.',
      },
    },
  },
  render: (args) => (
    <div className="space-y-6">
      {(['accent', 'warning', 'success'] as const).map((tone) => (
        <div key={tone} className="space-y-2">
          <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{tone}</p>
          <HeatmapChart
            {...args}
            tone={tone}
            label={`Absence, ${tone}`}
            rows={absence.people.slice(0, 3)}
            columns={absence.weeks.slice(0, 8)}
          />
        </div>
      ))}
    </div>
  ),
};
