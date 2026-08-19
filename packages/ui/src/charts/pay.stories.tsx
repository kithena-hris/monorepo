import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Badge } from '../components/badge/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import { RangeChart } from '../components/chart/range-chart';
import { ScatterChart } from '../components/chart/scatter-chart';

const bands = [
  { label: 'Grade 1', meta: '18 people', min: 32_000, max: 42_000, value: 34_500 },
  { label: 'Grade 2', meta: '44 people', min: 40_000, max: 54_000, value: 48_200 },
  { label: 'Grade 3', meta: '61 people', min: 52_000, max: 71_000, value: 59_800 },
  {
    label: 'Grade 4',
    meta: '29 people',
    min: 68_000,
    max: 94_000,
    value: 88_400,
    tone: 'info' as const,
  },
  {
    label: 'Grade 5',
    meta: '7 people',
    min: 90_000,
    max: 128_000,
    value: 132_000,
    tone: 'warning' as const,
  },
];

/** Deterministic: a random scatter is a different chart on every load. */
const equity = Array.from({ length: 42 }, (_, index) => {
  const rating = ((index * 7) % 5) + 1;
  const ratio = 0.82 + ((index * 13) % 40) / 100 + (rating - 3) * 0.03;
  return {
    label: `Employee ${String(index + 1)}`,
    x: rating,
    y: Math.round(ratio * 100) / 100,
    tone: index % 3 === 0 ? ('info' as const) : ('accent' as const),
    meta: index % 3 === 0 ? 'Joined in the last year' : 'Two years or more',
  };
});

const meta = {
  title: 'Charts/Pay',
  component: RangeChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'The two charts a pay review runs on, and the two a works council asks for.',
          '',
          '### `RangeChart`: bands, and where people sit in them',
          '',
          'One row per grade: the band from minimum to maximum, a marker at the midpoint, and a marker for the figure being compared.',
          '',
          '- **A band is a range, not a bar.** A bar from zero to the maximum says the bottom of the scale is zero, which for a salary band is both false and alarming. It starts at the minimum, because that is what a band *is*.',
          '- **The comparison is a marker, not a second bar.** "Below midpoint" becomes a position rather than an arithmetic exercise; two bars side by side make the reader do the subtraction, and they do it wrong.',
          '- **Out of band is stated, not implied.** A value past either end is pinned to the edge, drawn in the danger tone, and says *"above the maximum"* in words. Silently clamping it hides the exact case somebody opened the chart to find.',
          '- One scale across every row, so a narrow band does not look as wide as a broad one.',
          '',
          '### `ScatterChart`, two measures, one point per person',
          '',
          'Compa-ratio against performance rating. It is the shape that makes an outlier obvious, and an outlier in a pay chart is a **person**, not a data point, which is why every dot carries a name.',
          '',
          '- **Reference lines are the point.** A compa-ratio plot is unreadable without a line at 1.0. "Is this dot above or below the line" is the entire question.',
          '- **Colour groups. It does not measure.** Encoding a third measure in colour makes a chart that needs a legend and a paragraph; at that point the answer is two charts.',
          '- **Overlap is expected.** Points are semi-transparent so a cluster reads as a cluster. Thirty people on the same rating and ratio is a fact worth seeing, not an artefact to hide.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    data: { control: false, table: { category: 'Data' } },
    rowHeight: {
      control: { type: 'range', min: 24, max: 60, step: 2 },
      table: { category: 'Appearance' },
    },
    labelWidth: {
      control: { type: 'range', min: 80, max: 240, step: 10 },
      table: { category: 'Appearance' },
    },
    onSelect: { control: false, table: { category: 'Interaction' } },
    format: { control: false, table: { category: 'Data' } },
  },
  args: {
    data: bands,
    label: 'Salary bands and averages',
    valueLabel: 'Average salary',
    format: (value: number) => `€${(value / 1000).toFixed(0)}k`,
    onSelect: fn().mockName('onSelect(band)'),
  },
} satisfies Meta<typeof RangeChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bands: Story = {
  name: 'Salary bands',
  render: (args) => (
    <Card>
      <CardHeader>
        <CardTitle>Bands by grade</CardTitle>
        <Badge size="sm" tone="danger">
          Grade 5 above maximum
        </Badge>
      </CardHeader>
      <CardContent>
        <RangeChart {...args} />
      </CardContent>
    </Card>
  ),
};

export const OutOfBand: Story = {
  name: 'Out of band',
  parameters: {
    docs: {
      description: {
        story:
          'Grade 5’s average sits above the band maximum. The marker is pinned to the edge and turns red, and the readout says *"above the maximum"*, three signals for one fact, because this is the row somebody is looking for and it must not be the one that reads as normal.',
      },
    },
  },
  render: function OutOfBandStory(args) {
    const [selected, setSelected] = useState<string | null>('Grade 5');

    return (
      <Card>
        <CardHeader>
          <CardTitle>Bands by grade</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <RangeChart
            {...args}
            {...(selected === null ? {} : { selectedLabel: selected })}
            onSelect={(band) => {
              setSelected(band.label);
              args.onSelect?.(band);
            }}
          />
          <p aria-live="polite" className="min-h-5 text-sm text-fg-muted">
            {selected === null ? 'Select a band.' : `Selected: ${selected}`}
          </p>
        </CardContent>
      </Card>
    );
  },
};

export const Equity: Story = {
  name: 'Pay equity scatter',
  parameters: {
    docs: {
      description: {
        story:
          'Compa-ratio against performance rating, one dot per employee, coloured by tenure. The line at 1.0 is what makes it readable: dots below it are paid under the band midpoint, and a cluster of recent joiners sitting below the line while rating well is the pattern this chart exists to surface.',
      },
    },
  },
  render: function EquityStory() {
    const [selected, setSelected] = useState<string | null>(null);

    return (
      <Card>
        <CardHeader>
          <CardTitle>Compa-ratio by rating</CardTitle>
          <Badge size="sm">{equity.length} people</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScatterChart
            label="Compa-ratio by performance rating"
            data={equity}
            xLabel="Rating"
            yLabel="Compa-ratio"
            xRange={[0.5, 5.5]}
            referenceY={{ value: 1, label: 'Band midpoint' }}
            formatX={(value) => String(value)}
            formatY={(value) => value.toFixed(2)}
            {...(selected === null ? {} : { selectedLabel: selected })}
            onSelect={(point) => {
              setSelected(point.label);
            }}
          />
          <p aria-live="polite" className="min-h-5 text-sm text-fg-muted">
            {selected === null ? 'Select someone.' : `Selected: ${selected}`}
          </p>
        </CardContent>
      </Card>
    );
  },
};
