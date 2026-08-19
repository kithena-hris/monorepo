import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { useState } from 'react';

import { Badge } from '../components/badge/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/card/card';
import { FunnelChart, HorizontalBarChart } from '../components/chart/chart';
import { ToggleGroup, ToggleGroupItem } from '../components/toggle/toggle';
import { pipeline } from './fixtures';

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
  render: (args) => (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Hiring pipeline</CardTitle>
        <Badge size="sm">1.4% overall</Badge>
      </CardHeader>
      <CardContent>
        <FunnelChart {...args} />
      </CardContent>
    </Card>
  ),
};

export const FindingTheBottleneck: Story = {
  name: 'Finding the bottleneck',
  parameters: {
    docs: {
      description: {
        story:
          'Read the step conversions rather than the shape. The largest drop by *count* is applied → screened, losing 872, but that is a funnel doing its job. The one worth acting on is screened → interviewed at 36%, where 264 people who passed a human screen went nowhere. A taper drawn by area would have made the first look like the problem.',
      },
    },
  },
  render: (args) => (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <FunnelChart {...args} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Step conversion, ranked</CardTitle>
        </CardHeader>
        <CardContent>
          <HorizontalBarChart
            label="Step conversion by stage, percent"
            tone="warning"
            sorted={false}
            format={(value) => `${String(value)}%`}
            data={pipeline.slice(1).map((stage, index) => ({
              label: stage.label,
              value: Math.round((stage.value / (pipeline[index]?.value ?? 1)) * 100),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  ),
};

export const Comparing: Story = {
  name: 'Comparing two funnels',
  parameters: {
    docs: {
      description: {
        story:
          "Two roles, same stages. Switch between them: the bar lengths are relative to each funnel's own largest stage, so the *shapes* are comparable even though the volumes are not. What is not comparable is the bar length between the two charts, which is why the counts are printed and why they sit at the same place in each row.",
      },
    },
  },
  render: function ComparingStory(args) {
    const [role, setRole] = useState('engineering');
    const data =
      role === 'engineering'
        ? pipeline
        : [
            { label: 'Applied', value: 214 },
            { label: 'Screened', value: 96 },
            { label: 'Interviewed', value: 54 },
            { label: 'Onsite', value: 21 },
            { label: 'Offer', value: 9 },
            { label: 'Hired', value: 8 },
          ];

    return (
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
          <ToggleGroup
            type="single"
            value={role}
            onValueChange={(next) => {
              if (next) setRole(next);
            }}
            aria-label="Role family"
          >
            <ToggleGroupItem value="engineering" size="sm">
              Engineering
            </ToggleGroupItem>
            <ToggleGroupItem value="finance" size="sm">
              Finance
            </ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          <FunnelChart {...args} label={`Hiring pipeline, ${role}`} data={data} />
        </CardContent>
      </Card>
    );
  },
};

export const NotAlwaysFalling: Story = {
  name: 'When it does not narrow',
  parameters: {
    docs: {
      description: {
        story:
          'An onboarding sequence where a stage *gains* people: tasks reopened after a failed right-to-work check. A trapezoid cannot draw this at all; bars simply get longer, and the step conversion reads over 100%, which is the honest answer.',
      },
    },
  },
  render: (args) => (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Onboarding tasks</CardTitle>
      </CardHeader>
      <CardContent>
        <FunnelChart
          {...args}
          label="Onboarding task completion"
          data={[
            { label: 'Started', value: 120 },
            { label: 'Documents uploaded', value: 96 },
            { label: 'Right to work checked', value: 74, tone: 'warning' },
            { label: 'Returned for correction', value: 88, tone: 'danger' },
            { label: 'Completed', value: 71, tone: 'success' },
          ]}
        />
      </CardContent>
    </Card>
  ),
};
