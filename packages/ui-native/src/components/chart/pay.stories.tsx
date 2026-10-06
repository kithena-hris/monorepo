import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Lock } from 'lucide-react-native';

import { designDocs } from '../../docs/design.ts';
import { Badge } from '../badge/badge.tsx';
import { ChartCard } from './parts.tsx';
import { RangeChart, ScatterChart, type RangeBand } from './pay-chart.tsx';

const meta = {
  title: 'Charts/Pay',
  parameters: designDocs('pay'),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Salaries arrive in cents, as all money does; €k is only how they are printed. */
const k = (euros: number): number => euros * 100_000;
const inK = (cents: number): string => String(Math.round(cents / 100_000));

const rows: RangeBand[] = [
  {
    label: 'Engineer L2',
    min: k(62),
    max: k(82),
    mid: k(72),
    spread: { low: k(67), high: k(77) },
    people: [64, 70, 74, 79].map(k),
  },
  {
    label: 'Engineer L3',
    min: k(78),
    max: k(102),
    mid: k(90),
    spread: { low: k(84), high: k(96) },
    people: [82, 88, 92, 101, 105].map(k),
  },
  {
    label: 'Designer L3',
    min: k(70),
    max: k(92),
    mid: k(81),
    spread: { low: k(75), high: k(87) },
    people: [72, 84, 68].map(k),
  },
  {
    label: 'Manager L4',
    min: k(100),
    max: k(130),
    mid: k(115),
    spread: { low: k(107), high: k(123) },
    people: [112, 118].map(k),
  },
];

const scale = {
  valueLabel: 'Base salary, €k',
  domain: [k(55), k(135)] as const,
  ticks: [55, 75, 95, 115, 135].map(k),
  format: inK,
};

export const SalaryBands: Story = {
  name: 'Salary bands',
  render: () => (
    <ChartCard
      title="Bands by level, €k"
      action={
        <Badge size="sm" icon={Lock}>
          HR only
        </Badge>
      }
    >
      <RangeChart
        label="Salary bands by level"
        {...scale}
        data={rows.map(({ label, min, max }) => ({ label, min, max }))}
      />
    </ChartCard>
  ),
};

export const OutOfBand: Story = {
  name: 'Out of band',
  render: () => (
    <ChartCard title="People by band, €k" description="2 people outside their band">
      <RangeChart
        label="People against their salary band"
        summary="Two people are outside their band: one Engineer L3 above it, one Designer L3 below it."
        {...scale}
        data={rows.map(({ label, min, max, people }) => ({
          label,
          min,
          max,
          ...(people ? { people } : {}),
        }))}
      />
    </ChartCard>
  ),
};

export const MedianAndMiddleHalf: Story = {
  name: 'Median and middle half',
  render: () => (
    <ChartCard title="Median and interquartile range, €k">
      <RangeChart
        label="Median and middle half of pay by level"
        {...scale}
        data={rows}
        spreadLabel="Middle half"
        midLabel="Median"
      />
    </ChartCard>
  ),
};

const people = [
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
] as const;
const names = [
  'Priya Shah',
  'Jonas Weber',
  'Amara Okafor',
  'Lucas Moreau',
  'Mei Tanaka',
  'Omar Haddad',
  'Yuki Sato',
  'Hana Kim',
  'Zara Ahmed',
  'Tom Fischer',
  'Nora Becker',
  'Leo Rossi',
  'Sofia Costa',
  'Ben Carter',
  'Ines Duarte',
  'Kai Müller',
  'Ama Mensah',
];

export const PayEquityScatter: Story = {
  name: 'Pay equity scatter',
  render: () => (
    <ChartCard
      title="Salary vs level, by gender"
      description="Women earn 2.1% less at the same level (adjusted)"
    >
      <ScatterChart
        label="Salary against level, by gender"
        summary="At every level the women's fit line sits about 2% under the men's."
        xLabel="Level"
        yLabel="Salary, €k"
        xRange={[0.5, 5.5]}
        yRange={[k(55), k(140)]}
        xTicks={[1, 2, 3, 4, 5].map((level) => ({ value: level, label: `L${String(level)}` }))}
        formatX={(v) => `L${String(Math.round(v))}`}
        formatY={inK}
        fitLines
        data={people.map(([level, salary, woman], i) => ({
          label: names[i] ?? `Person ${String(i + 1)}`,
          x: level + (woman ? 0.12 : -0.12),
          y: k(salary),
          group: woman ? 'Women' : 'Men',
          tone: woman ? ('chart-4' as const) : ('chart-1' as const),
        }))}
      />
    </ChartCard>
  ),
};
