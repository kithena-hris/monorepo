import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { designDocs } from '../../docs/design.ts';
import { Alert } from '../feedback/feedback.tsx';
import { Stack } from '../layout/layout.tsx';
import { FunnelChart } from './distribution-chart.tsx';
import { ChartCard } from './parts.tsx';

const hiring = [
  { label: 'Applied', value: 1240 },
  { label: 'Screened', value: 420 },
  { label: 'Interviewed', value: 96 },
  { label: 'Offered', value: 24 },
  { label: 'Hired', value: 19 },
];

const meta = {
  title: 'Charts/Funnel',
  component: FunnelChart,
  parameters: designDocs('funnel'),
  args: {
    label: 'Hiring funnel, Q3',
    summary: '1,240 applied and 19 were hired. 24 offers were made.',
    data: hiring,
  },
} satisfies Meta<typeof FunnelChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <ChartCard title="Hiring, Q3" value="24 offers">
      <FunnelChart {...args} />
    </ChartCard>
  ),
};

export const FindingTheBottleneck: Story = {
  name: 'Finding the bottleneck',
  render: () => (
    <ChartCard title="Hiring, Q3" description="Only 23% of screened candidates get an interview">
      <FunnelChart
        label="Hiring funnel, Q3"
        summary="The biggest drop is from screening to interview: only 23% carry on."
        data={hiring}
        highlightBiggestDrop
      />
    </ChartCard>
  ),
};

export const ComparingTwoFunnels: Story = {
  name: 'Comparing two funnels',
  render: () => (
    <Stack gap={3}>
      <ChartCard title="Referrals" value="32% hired">
        <FunnelChart
          label="Referral hiring funnel"
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
          label="Job board hiring funnel"
          tone="chart-1"
          data={[
            { label: 'Applied', value: 1160 },
            { label: 'Interview', value: 50 },
            { label: 'Hired', value: 12 },
          ]}
        />
      </ChartCard>
    </Stack>
  ),
};

export const WhenItDoesNotNarrow: Story = {
  name: 'When it does not narrow',
  render: () => (
    <Stack gap={3}>
      <FunnelChart
        label="Survey completion"
        summary="104 completed but only 96 started: the tracking is missing events."
        data={[
          { label: 'Invited', value: 120 },
          { label: 'Started', value: 96 },
          { label: 'Completed', value: 104 },
        ]}
      />
      <Alert tone="warning" title="More completed than started">
        Some people finished without a &quot;started&quot; event. Check the tracking before you
        trust these numbers.
      </Alert>
    </Stack>
  ),
};
