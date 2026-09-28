import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { FunnelChart } from '../components/chart/chart';
import { ChartCard } from '../components/chart/chart-card';
import { Alert } from '../components/feedback/feedback';
import { AutoGrid } from '../components/layout/layout';
import { hiringFunnel, pipeline } from './fixtures';

const meta = {
  title: 'Charts/Funnel',
  component: FunnelChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A sequence people fall out of: applied → screened → interviewed → onsite → offer → hired.',
          '',
          '### Not a trapezoid',
          '',
          'The classic funnel shape encodes value as **area**, and people judge area badly, a stage with half the count reads as roughly a third. These are bars on a shared baseline whose *length* is the value, which is the comparison the eye is actually good at. It happens to look like a funnel because the numbers fall. If they do not fall, the chart says so instead of drawing a taper that implies they did.',
          '',
          '### The conversion is the number people want',
          '',
          'Two of them, and they answer different questions. **Step conversion** ("32% of the previous stage") finds the stage that is broken. **Overall conversion** ("1.4% of applicants") is the one that goes in a board pack. Both are printed, because working the second out from five of the first is arithmetic nobody should be doing in their head.',
          '',
          'The count lost at each step is printed too, a percentage drop on a small stage is dramatic and often meaningless, and "68 lost" is the number that decides whether it is worth fixing.',
          '',
          '### Order is the meaning',
          '',
          'It renders an `<ol>`. A funnel whose stages can be sorted is not a funnel, so there is no sort option.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    data: {
      description: 'Stages in order. The first is the denominator for the overall percentage.',
      control: 'object',
      table: { type: { summary: 'readonly FunnelStage[]' }, category: 'Data' },
    },
    label: { control: 'text', table: { type: { summary: 'string' }, category: 'Data' } },
    showConversion: {
      description: 'Prints the step conversion and the count lost under each stage.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'true' },
        category: 'Appearance',
      },
    },
    format: {
      control: false,
      table: { type: { summary: '(value: number) => string' }, category: 'Data' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Hiring pipeline, 2026',
    data: pipeline,
    showConversion: true,
    // Spies, so the **Actions** panel shows what the callback is handed and
    // when, the fastest answer to the question people actually have about a
    // chart's API.
    onSelect: fn(),
    onWindowChange: fn(),
  },
} satisfies Meta<typeof FunnelChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    label: 'Hiring, Q3',
    data: hiringFunnel,
  },
  render: (args) => (
    <ChartCard title="Hiring, Q3" value="24 offers">
      <FunnelChart {...args} />
    </ChartCard>
  ),
};

export const FindingTheBottleneck: Story = {
  name: 'Finding the bottleneck',
  args: {
    label: 'Hiring, Q3',
    data: hiringFunnel,
    highlightBiggestDrop: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Read the step conversions rather than the shape. The largest drop by *count* is applied → screened, but that is a funnel doing its job. `highlightBiggestDrop` finds the worst step by *share*, screened → interviewed at 23%, paints it in the danger tone and says so in words.',
      },
    },
  },
  render: (args) => (
    <ChartCard title="Hiring, Q3" description="Only 23% of screened candidates get an interview">
      <FunnelChart {...args} />
    </ChartCard>
  ),
};

export const Comparing: Story = {
  name: 'Comparing two funnels',
  parameters: {
    docs: {
      description: {
        story:
          "Two sources, same stages, each in its own palette colour. The bar lengths are relative to each funnel's own first stage, so the *shapes* are comparable even though the volumes are not; the counts are printed for the volumes.",
      },
    },
  },
  render: () => (
    <AutoGrid minItemWidth="16.25rem" gap={3}>
      <ChartCard title="Referrals" value="32% hired">
        <FunnelChart
          label="Referral pipeline"
          tone="chart-2"
          data={[
            { label: 'Applied', value: 80 },
            { label: 'Interview', value: 46 },
            { label: 'Hired', value: 26 },
          ]}
        />
      </ChartCard>
      <ChartCard title="Job boards" value="1% hired">
        <FunnelChart
          label="Job board pipeline"
          data={[
            { label: 'Applied', value: 1160 },
            { label: 'Interview', value: 50 },
            { label: 'Hired', value: 12 },
          ]}
        />
      </ChartCard>
    </AutoGrid>
  ),
};

export const NotAlwaysFalling: Story = {
  name: 'When it does not narrow',
  parameters: {
    docs: {
      description: {
        story:
          'A stage that *gains* people. A trapezoid cannot draw this at all; bars simply get longer, and the step reads over 100% in the warning tone, which is the honest answer. Pair it with an alert saying what to check.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col gap-3">
      <FunnelChart
        label="Survey completion"
        data={[
          { label: 'Invited', value: 120 },
          { label: 'Started', value: 96 },
          { label: 'Completed', value: 104 },
        ]}
      />
      <Alert tone="warning" title="More completed than started">
        Some people finished without a &ldquo;started&rdquo; event. Check the tracking before you
        trust these numbers.
      </Alert>
    </div>
  ),
};
