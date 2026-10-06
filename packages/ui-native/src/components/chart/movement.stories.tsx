import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs, designNote } from '../../docs/design.ts';
import { WaterfallChart, type WaterfallStep } from './movement-chart.tsx';
import { ChartCard } from './parts.tsx';

const quarter: WaterfallStep[] = [
  { label: '1 Jul', value: 297, total: true },
  { label: 'Hires', value: 32 },
  { label: 'Transfers in', value: 4 },
  { label: 'Leavers', value: -14 },
  { label: 'Transfers out', value: -7 },
  { label: '30 Sep', value: 312, total: true },
];

const meta = {
  title: 'Charts/Movement',
  component: WaterfallChart,
  parameters: designDocs('movement'),
  args: {
    label: 'Headcount movement, Q3',
    summary: 'Headcount rose from 297 to 312: 36 joined and 21 left.',
    data: quarter,
  },
} satisfies Meta<typeof WaterfallChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <ChartCard title="Headcount, Q3" value="297 → 312">
      <WaterfallChart {...args} />
    </ChartCard>
  ),
};

export const ReadingTheBiggestStep: Story = {
  name: 'Reading the biggest step',
  render: () => (
    <ChartCard title="Headcount, Q3" description="Hiring drove the growth: 32 people">
      <WaterfallChart
        label="Headcount movement, Q3"
        summary="Hiring was the biggest step: 32 people."
        data={quarter}
        highlightIndex={1}
      />
    </ChartCard>
  ),
};

/** Money in minor units, printed in thousands of euros: the card's title names the unit. */
const euros = (cents: number): string =>
  `${cents < 0 ? '\u2212' : ''}${String(Math.round(Math.abs(cents) / 100_000))}`;

export const WhenItGoesNegative: Story = {
  name: 'When it goes negative',
  parameters: designNote('movement', 'When it goes negative'),
  render: () => (
    <ChartCard title="Budget vs spend, €k" value="−€18k">
      <WaterfallChart
        label="Budget against spend, in thousands of euros"
        summary="Spending ran €8k over a budget of €40k."
        format={euros}
        data={[
          { label: 'Budget', value: 4_000_000, total: true },
          { label: 'Salaries', value: -3_800_000 },
          { label: 'Contractors', value: -1_400_000 },
          { label: 'Refunds', value: 400_000 },
          { label: 'Balance', value: -800_000, total: true },
        ]}
      />
    </ChartCard>
  ),
};
