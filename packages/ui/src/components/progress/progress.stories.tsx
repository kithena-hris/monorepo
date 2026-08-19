import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Button } from '../button/button';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
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
    value: 62,
    max: 100,
    label: 'Importing employees',
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
  args: { value: null, label: 'Connecting to Workday' },
  parameters: {
    docs: {
      description: {
        story:
          'The sweep. There is no `aria-valuenow` here, deliberately: a screen reader announces the region as busy without inventing a number nobody knows.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-md space-y-4">
      <Progress {...args} />
      <Progress {...args} showValue={false} label="Reconciling payroll" tone="warning" />
    </div>
  ),
};

export const Live: Story = {
  name: 'A running job',
  parameters: {
    docs: {
      description: {
        story:
          'A real import, animated. Note that the bar starts *indeterminate*, the row count is unknown until the file has been parsed, and only becomes determinate once there is a total to divide by. That transition is the honest shape of most long jobs.',
      },
    },
  },
  render: function LiveStory() {
    const [tick, setTick] = useState(0);
    const [running, setRunning] = useState(false);

    useEffect(() => {
      if (!running) return;
      const id = setInterval(() => {
        setTick((current) => {
          if (current >= 130) {
            setRunning(false);
            return current;
          }
          return current + 1;
        });
      }, 60);
      return () => {
        clearInterval(id);
      };
    }, [running]);

    // The first 30 ticks are the parse, where the total is not yet known.
    const value = tick < 30 ? null : Math.min(100, ((tick - 30) / 100) * 100);
    const done = tick >= 130;

    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Import from Workday</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress
            value={done ? 100 : value}
            label={
              value === null && running
                ? 'Reading file…'
                : done
                  ? 'Imported 4,182 employees'
                  : 'Importing employees'
            }
            showValue
            tone={done ? 'success' : 'accent'}
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                setTick(0);
                setRunning(true);
              }}
              disabled={running}
            >
              {done ? 'Run again' : 'Start import'}
            </Button>
            {running ? (
              <Button
                onClick={() => {
                  setRunning(false);
                }}
              >
                Pause
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  },
};

export const Tones: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Tone reflects what the value *means*, not how far along it is. The last bar is red because 106% of an entitlement has been taken, which is a payroll problem, not because it is nearly full.',
      },
    },
  },
  render: () => (
    <div className="max-w-md space-y-5">
      <Progress value={42} label="Onboarding tasks complete" showValue tone="accent" />
      <Progress value={100} label="Right-to-work checks" showValue tone="success" />
      <Progress value={88} label="Annual leave taken" showValue tone="warning" />
      {/* 26 days taken against a 25-day entitlement. The bar stops at full and
          the figure reads 104%, because the overage is that matters. */}
      <Progress
        value={26}
        max={25}
        label="Sick leave against entitlement"
        showValue
        tone="danger"
      />
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
    <div className="flex flex-wrap items-end gap-8">
      {(
        [
          [22, 'accent', 'Leave taken'],
          [64, 'success', 'Onboarding'],
          [88, 'warning', 'Budget used'],
          [100, 'danger', 'Entitlement'],
        ] as const
      ).map(([value, tone, label]) => (
        <div key={label} className="space-y-2 text-center">
          <CircularProgress value={value} tone={tone} label={label} size={64} />
          <p className="text-xs text-fg-muted">{label}</p>
        </div>
      ))}
      <div className="space-y-2 text-center">
        <CircularProgress value={null} label="Syncing" size={64} />
        <p className="text-xs text-fg-muted">Indeterminate</p>
      </div>
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
    <div className="max-w-lg divide-y divide-border rounded-lg border border-border bg-surface">
      {(
        [
          ['Grace Hopper', 18, 25],
          ['Ada Lovelace', 24, 25],
          ['Radia Perlman', 6, 25],
        ] as const
      ).map(([name, used, total]) => (
        <div key={name} className="flex items-center gap-4 px-4 py-3">
          <span className="w-40 shrink-0 text-base text-fg">{name}</span>
          <Progress
            value={used}
            max={total}
            size="sm"
            label={`Leave taken by ${name}`}
            tone={used / total > 0.9 ? 'warning' : 'accent'}
          />
          <span className="w-16 shrink-0 text-right text-sm tabular-nums text-fg-muted">
            {used}/{total}
          </span>
        </div>
      ))}
    </div>
  ),
};
