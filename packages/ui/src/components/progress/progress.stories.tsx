import type { Meta, StoryObj } from '@storybook/react-vite';
import { Wallet } from 'lucide-react';

import { Button } from '../button/button';
import { Card, CardContent } from '../card/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table/table';
import { CircularProgress, Progress } from './progress';

const meta = {
  title: 'Components/Progress',
  component: Progress,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Determinate and indeterminate progress, as a bar or a ring.',
          '',
          '### The choice is a data question, not a design one',
          '',
          'Show a percentage only when the total is genuinely known. A bar that creeps to 90% and stops is worse than a sweep, because it made a promise the system could not keep, and "import some number of rows that Workday will tell us about eventually" is exactly that case. Pass `value={null}` and the component renders the indeterminate sweep, with no `aria-valuenow`, which is precisely how a screen reader is told *busy, length unknown*.',
          '',
          '### Bar or ring',
          '',
          '| | Use for |',
          '| --- | --- |',
          '| `Progress` | A process the user is waiting on: an import, an upload, a payroll run. Full width, in context. |',
          '| `CircularProgress` | A ratio in a dense tile: leave used against entitlement, budget consumed. |',
          '',
          'Neither is a loading spinner. If the wait has no measurable progress and no known length, use `Spinner`.',
          '',
          '### Accessibility',
          '',
          '`label` is required on both. A bar with no accessible name is announced as a rectangle. When `showValue` is on, the label is visible and is used as the visible text; otherwise it becomes `aria-label`.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: {
      description:
        'Current value, or `null` for indeterminate. `null` is not "zero". It means the total is unknown.',
      control: { type: 'range', min: 0, max: 100, step: 1 },
      table: {
        type: { summary: 'number | null' },
        defaultValue: { summary: 'null' },
        category: 'Data',
      },
    },
    max: {
      description: 'The total. Set it when your value is not already a percentage.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, defaultValue: { summary: '100' }, category: 'Data' },
    },
    label: {
      description: 'Required. Becomes visible text when `showValue` is on, `aria-label` otherwise.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
    valueLabel: {
      description: 'Printed and read out in place of the percentage: a count, or time left.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Content' },
    },
    showValue: {
      description: 'Prints the label and the rounded percentage above the bar.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    size: {
      description: 'Track thickness. `sm` for a bar inside a table row.',
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    tone: {
      description:
        'Semantic colour. Use `danger` when the value crossing the bar is itself the problem: leave taken over entitlement, for instance.',
      control: 'inline-radio',
      options: ['accent', 'success', 'warning', 'danger'],
      table: {
        type: { summary: "'accent' | 'success' | 'warning' | 'danger'" },
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
    value: 7,
    max: 11,
    label: 'Onboarding',
    valueLabel: '7 of 11 tasks',
    showValue: true,
    size: 'md',
    tone: 'accent',
  },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="max-w-md">
      <Progress {...args} />
    </div>
  ),
};

export const Indeterminate: Story = {
  args: { value: null, label: 'Importing people', valueLabel: '' },
  parameters: {
    docs: {
      description: {
        story:
          'The sweep. There is no `aria-valuenow` here, deliberately: a screen reader announces the region as busy without inventing a number nobody knows.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-md">
      <Progress {...args} />
    </div>
  ),
};

export const Live: Story = {
  name: 'A running job',
  parameters: {
    docs: {
      description: {
        story:
          'A job someone is waiting on, in context: what it is, who started it, the count done and the time left. The count is the fact, so it replaces the percentage.',
      },
    },
  },
  render: () => (
    <Card className="max-w-md">
      <CardContent className="space-y-3.5 pt-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-sm bg-accent-subtle text-accent-fg [&_svg]:size-5"
          >
            <Wallet />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-fg">September payroll</p>
            <p className="text-sm text-fg-muted">Started 14:02 by Zara Ahmed</p>
          </div>
        </div>
        <Progress
          value={226}
          max={312}
          label="226 of 312 payslips"
          valueLabel="About 2 min left"
          showValue
        />
        <div className="flex justify-end">
          <Button size="sm">Cancel run</Button>
        </div>
      </CardContent>
    </Card>
  ),
};

export const Tones: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Tone reflects what the value *means*, not how far along it is. The last bar is red because the plan is exceeded, which is a problem, not because it is nearly full.',
      },
    },
  },
  render: () => (
    <div className="max-w-md space-y-3.5">
      <Progress value={64} label="Profile complete" showValue tone="accent" />
      <Progress value={100} label="Training done" showValue tone="success" />
      <Progress value={88} label="Budget used" showValue tone="warning" />
      {/* 104 hires against a plan of 100. The bar stops at full and the figure
          reads 104%, because the overage is what matters. */}
      <Progress value={104} label="Over headcount plan" showValue tone="danger" />
    </div>
  ),
};

export const Rings: Story = {
  name: 'Circular',
  parameters: {
    docs: {
      description: {
        story:
          'The same values as rings, for a dense tile. Drawn with `stroke-dasharray` rather than a conic gradient so the cap is round and the unfilled track stays visible, a ring with no visible track cannot show "12% of what".',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-5">
      <CircularProgress value={25} label="Leave taken" size={56} />
      <CircularProgress value={64} tone="success" label="Onboarding" size={72} />
      <CircularProgress value={92} tone="warning" label="Budget used" size={56} />
      <CircularProgress value={null} label="Syncing" size={40} />
    </div>
  ),
};

export const InATableRow: Story = {
  name: 'In a table row',
  parameters: {
    docs: {
      description: {
        story:
          'At `sm`, inside a row, with the number beside it rather than above. Never rely on the bar alone in a table, the value is the fact, the bar is the comparison.',
      },
    },
  },
  render: () => (
    <Table aria-label="Onboarding" className="max-w-lg">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Onboarding</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(
          [
            ['Amara Okafor', 40],
            ['Lucas Moreau', 100],
            ['Mei Tanaka', 72],
          ] as const
        ).map(([name, done]) => (
          <TableRow key={name}>
            <TableCell className="font-medium">{name}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <Progress
                  value={done}
                  size="sm"
                  label={`Onboarding for ${name}`}
                  tone={done === 100 ? 'success' : 'accent'}
                />
                <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-fg-muted">
                  {done}%
                </span>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

/**
 * Several shares of one total. The first is spent, the second committed and
 * not final, so it is hatched, and its label says so as well: the stripes are
 * never the only signal. The image's name reads the whole line.
 */
export const Segments: Story = {
  args: { label: 'Allowance' },
  render: () => (
    <div className="flex max-w-sm flex-col gap-6">
      <Card padded>
        <CardContent className="flex flex-col gap-2.5 p-0">
          <p className="text-sm font-medium text-fg-muted">Allowance</p>
          <p className="font-display text-3xl font-bold tabular-nums">19</p>
          <Progress
            label="Allowance"
            max={25}
            size="lg"
            showValue
            valueLabel="25 a year"
            segments={[
              { value: 4, label: '4 used' },
              { value: 2, label: '2 booked', pattern: 'hatched' },
            ]}
          />
        </CardContent>
      </Card>
      <Progress
        label="Budget"
        max={10}
        showValue
        valueLabel="10 in total"
        segments={[
          { value: 3, label: '3 spent', tone: 'chart-3' },
          { value: 4, label: '4 committed', tone: 'chart-3', pattern: 'hatched' },
          { value: 1, label: '1 over', tone: 'danger' },
        ]}
      />
    </div>
  ),
};
