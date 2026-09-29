import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Badge } from '../components/badge/badge';
import { ChartCard } from '../components/chart/chart-card';
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
    tone: 'chart-2' as const,
  },
  {
    label: 'Grade 5',
    meta: '7 people',
    min: 90_000,
    max: 128_000,
    value: 132_000,
    tone: 'chart-3' as const,
  },
];

/** The design's four levels, in €k, with the people in each. */
const levels = [
  { label: 'Engineer L2', min: 62, max: 82, mid: 72, q: [67, 77], people: [64, 70, 74, 79] },
  { label: 'Engineer L3', min: 78, max: 102, mid: 90, q: [84, 96], people: [82, 88, 92, 101, 105] },
  { label: 'Designer L3', min: 70, max: 92, mid: 81, q: [75, 87], people: [72, 84, 68] },
  { label: 'Manager L4', min: 100, max: 130, mid: 115, q: [107, 123], people: [112, 118] },
] as const;

const thousands = (value: number): string => `€${String(Math.round(value))}k`;

/** Salary against level, by gender, nudged apart so the two groups do not sit on one another. */
const byGender = (
  [
    [1, 64, 0],
    [1, 66, 1],
    [1, 70, 0],
    [1, 63, 1],
    [2, 78, 0],
    [2, 76, 1],
    [2, 82, 0],
    [2, 80, 1],
    [3, 90, 0],
    [3, 87, 1],
    [3, 96, 0],
    [3, 92, 1],
    [4, 112, 0],
    [4, 108, 1],
    [4, 120, 0],
    [5, 132, 0],
    [5, 128, 1],
  ] as const
).map(([level, salary, woman], index) => ({
  label: `${woman ? 'Woman' : 'Man'}, L${String(level)} (${String(index + 1)})`,
  x: level + (woman ? 0.12 : -0.12),
  y: salary,
  group: woman ? 'Women' : 'Men',
  tone: woman ? ('chart-4' as const) : ('chart-1' as const),
}));

/** Deterministic: a random scatter is a different chart on every load. */
const equity = Array.from({ length: 42 }, (_, index) => {
  const rating = ((index * 7) % 5) + 1;
  const ratio = 0.82 + ((index * 13) % 40) / 100 + (rating - 3) * 0.03;
  return {
    label: `Employee ${String(index + 1)}`,
    x: rating,
    y: Math.round(ratio * 100) / 100,
    tone: index % 3 === 0 ? ('chart-4' as const) : ('chart-1' as const),
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
    <ChartCard
      title="Bands by grade, €"
      action={
        <Badge size="sm" tone="sensitive">
          HR only
        </Badge>
      }
    >
      <RangeChart {...args} />
    </ChartCard>
  ),
};

export const OutOfBand: Story = {
  name: 'Out of band',
  parameters: {
    docs: {
      description: {
        story:
          '`people` draws one dot per salary. Inside the band a dot is hollow and quiet; outside it is solid red with a halo, and the row’s readout counts them in words: *"5 people, 1 outside it"*. Two signals and a sentence for one fact, because this is the dot somebody opened the chart to find.',
      },
    },
  },
  args: {
    label: 'People by band',
    valueLabel: 'Salary, €k',
    format: thousands,
    data: levels.map(({ label, min, max, people }) => ({ label, min, max, people })),
  },
  render: function OutOfBandStory(args) {
    const [selected, setSelected] = useState<string | null>(null);

    return (
      <ChartCard
        title="People by band, €k"
        description={selected === null ? '2 people outside their band' : `Selected: ${selected}`}
      >
        <RangeChart
          {...args}
          {...(selected === null ? {} : { selectedLabel: selected })}
          onSelect={(band) => {
            setSelected(band.label);
            args.onSelect?.(band);
          }}
        />
      </ChartCard>
    );
  },
};

export const Spread: Story = {
  name: 'Median and middle half',
  parameters: {
    docs: {
      description: {
        story:
          '`spread` draws the middle half of a distribution across the band, and `mid` with `midLabel="Median"` its median. It shows where most people sit without drawing any one of them, which is what a chart must do when a minimum or a maximum would be somebody’s salary. With `people` as well, the dots say how the rest are spread, and a key under the chart names the marks.',
      },
    },
  },
  args: {
    label: 'Median and interquartile range',
    valueLabel: 'Salary, €k',
    spreadLabel: 'Middle half',
    midLabel: 'Median',
    format: thousands,
    data: levels.map(({ label, min, max, mid, q, people }) => ({
      label,
      min,
      max,
      mid,
      people,
      spread: { low: q[0], high: q[1] },
    })),
  },
  render: (args) => (
    <ChartCard title="Median and interquartile range, €k">
      <RangeChart {...args} />
    </ChartCard>
  ),
};

export const Equity: Story = {
  name: 'Pay equity scatter',
  parameters: {
    docs: {
      description: {
        story:
          'Salary against level, one dot per person, coloured by gender. `fitLines` draws a least-squares line per group: two near-parallel lines a step apart is what "paid less at the same level" looks like, and the gap between them is the number worth reading. The lines are written out for a screen reader too, since a slope is a conclusion only the eye can otherwise reach.',
      },
    },
  },
  render: () => (
    <ChartCard
      title="Salary vs level, by gender"
      description="Women earn 2.1% less at the same level (adjusted)"
    >
      <ScatterChart
        label="Salary against level, by gender"
        data={byGender}
        xLabel="Level"
        yLabel="Salary, €k"
        xRange={[0.5, 5.5]}
        yRange={[55, 140]}
        formatX={(value) => `L${value.toFixed(1).replace('.0', '')}`}
        formatY={thousands}
        fitLines
      />
    </ChartCard>
  ),
};

export const CompaRatio: Story = {
  name: 'Compa-ratio by rating',
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
      <ChartCard
        title="Compa-ratio by rating"
        description={
          selected === null ? `${String(equity.length)} people · select someone` : selected
        }
      >
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
      </ChartCard>
    );
  },
};
