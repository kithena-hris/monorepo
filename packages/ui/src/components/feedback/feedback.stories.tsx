import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarOff, Inbox, Search } from 'lucide-react';

import { Button } from '../button/button';
import { Alert, EmptyState, Skeleton } from './feedback';

const meta = {
  title: 'Components/Feedback',
  component: Alert,
  subcomponents: { EmptyState, Skeleton },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Telling the user what is happening: a message about the surrounding content, a placeholder while it loads, and an honest account of why there is nothing to show.',
          '',
          '### Alert',
          '',
          'Inline and tied to its context. `danger` and `warning` render as `role="alert"` and announce assertively; `info` and `success` are `role="status"` and wait their turn rather than cutting off whatever the screen reader is currently saying.',
          '',
          'An alert is not a toast. It lives in the layout, does not time out, and does not stack.',
          '',
          '### Skeleton',
          '',
          'Shaped like the content it replaces. If the skeleton and the real content have different geometry, the page jumps when data lands and the skeleton has made things worse.',
          '',
          '### EmptyState',
          '',
          'Names the reason and offers the next step. "No results" on its own tells the user what they can already see.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    tone: {
      description: 'Severity. Also decides whether the message announces assertively.',
      control: 'inline-radio',
      options: ['info', 'success', 'warning', 'danger'],
      table: {
        type: { summary: "'info' | 'success' | 'warning' | 'danger'" },
        defaultValue: { summary: 'info' },
        category: 'Appearance',
      },
    },
    title: {
      description: 'The headline. State the fact; keep the detail for the body.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    children: {
      description: 'Supporting detail, what happened, and what the user can do about it.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    action: {
      description: 'A single trailing action. Usually a ghost button.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    hideIcon: {
      description: 'Drop the leading icon when the surrounding layout already conveys the tone.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    tone: 'info',
    title: 'Effective dating',
    children:
      'Recorded on 15 August, effective from 1 August. Payroll will compute the retroactive delta on the next run.',
    hideIcon: false,
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="max-w-2xl">
      <Alert {...args} />
    </div>
  ),
};

export const AlertTones: Story = {
  name: 'Alert tones',
  parameters: {
    docs: {
      description: {
        story:
          'Read the `danger` message: it says what was preserved, not only what failed. An error that does not tell the user whether their work survived is an error that generates a support ticket.',
      },
    },
  },
  render: () => (
    <div className="grid max-w-2xl gap-3">
      <Alert tone="info" title="Effective dating">
        Recorded on 15 August, effective from 1 August. Payroll will compute the retroactive delta
        on the next run.
      </Alert>
      <Alert tone="success" title="Request approved">
        Grace Hopper was notified.
      </Alert>
      <Alert
        tone="warning"
        title="Balance goes negative"
        action={
          <Button size="sm" variant="ghost">
            Review
          </Button>
        }
      >
        This request exceeds the remaining 2026 entitlement by 1.5 days.
      </Alert>
      <Alert tone="danger" title="Could not reach the payroll module">
        The request was queued and will be retried automatically. Nothing has been lost.
      </Alert>
    </div>
  ),
};

export const AlertVariations: Story = {
  name: 'Alert variations',
  parameters: {
    docs: {
      description: {
        story:
          'Title only, body only, and without the icon, all three read correctly on their own.',
      },
    },
  },
  render: () => (
    <div className="grid max-w-2xl gap-3">
      <Alert tone="info" title="Two approvals are waiting on you." />
      <Alert tone="warning">
        This tenant has no payroll provider configured, so no run can be scheduled.
      </Alert>
      <Alert tone="success" hideIcon title="Saved">
        The change takes effect on 1 September 2026.
      </Alert>
    </div>
  ),
};

export const Skeletons: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Match the geometry of what is coming: circle for an avatar, a line at the width the text will occupy. The shimmer stops entirely under `prefers-reduced-motion`.',
      },
    },
  },
  render: () => (
    <div className="max-w-md space-y-3 rounded-lg border border-border p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  ),
};

export const EmptyStates: Story = {
  name: 'Empty states',
  parameters: {
    docs: {
      description: {
        story:
          'Three different reasons for emptiness: nothing yet, nothing in this period, and nothing matching a filter. Each deserves different words, and only the last one should offer to clear a filter.',
      },
    },
  },
  render: () => (
    <div className="grid max-w-2xl gap-4">
      <EmptyState
        icon={<Inbox />}
        title="No requests waiting on you"
        description="Anything your reports file will land here for approval."
      />
      <EmptyState
        icon={<CalendarOff />}
        title="No leave recorded in 2026"
        description="Balances start accruing from the hire date. This person joined on 3 June 2026."
        action={<Button variant="primary">File a request</Button>}
      />
      <EmptyState
        icon={<Search />}
        title="No one matches those filters"
        description="Three filters are active. Clearing the location filter would show 118 people."
        action={<Button variant="secondary">Clear filters</Button>}
      />
    </div>
  ),
};
