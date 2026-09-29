import type { Meta, StoryObj } from '@storybook/react-vite';
import { Inbox, RotateCw, SearchX, UserPlus } from 'lucide-react';

import { Button } from '../button/button';
import { Card } from '../card/card';
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
      options: ['info', 'success', 'warning', 'danger', 'accent', 'neutral'],
      table: {
        type: { summary: "'info' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral'" },
        defaultValue: { summary: 'info' },
        category: 'Appearance',
      },
    },
    variant: {
      description:
        '`soft` among content, `outline` on a busy background, `solid` for a blocking problem, `banner` edge to edge.',
      control: 'inline-radio',
      options: ['soft', 'outline', 'solid', 'banner'],
      table: {
        type: { summary: "'soft' | 'outline' | 'solid' | 'banner'" },
        defaultValue: { summary: 'soft' },
        category: 'Appearance',
      },
    },
    actions: {
      description: 'Actions under the message: Retry, View details.',
      control: false,
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    onDismiss: {
      description: 'Renders a close control. The caller removes the alert.',
      control: false,
      table: { type: { summary: '() => void' }, category: 'Events' },
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
      <Alert
        tone="danger"
        title="Could not reach the payroll module"
        actions={
          <Button size="xs" variant="secondary" startIcon={<RotateCw />}>
            Retry now
          </Button>
        }
      >
        The request was queued and will be retried automatically. Nothing has been lost.
      </Alert>
      <Alert tone="accent" title="New: split leave across two blocks">
        Parental leave can now be taken in up to two blocks in the first year.
      </Alert>
      <Alert tone="neutral" title="Office closed on 24 December" onDismiss={() => undefined}>
        Requests for that day are approved automatically and do not use a balance.
      </Alert>
    </div>
  ),
};

export const AlertVariations: Story = {
  name: 'Alert variations',
  parameters: {
    docs: {
      description: {
        story: [
          '`soft` is the default, inside content. `outline` keeps the surface and marks only the edge, for a busy background. `solid` is the full colour, for a blocking problem only. `banner` runs edge to edge across the top of a page or a panel.',
          '',
          'Title only, body only and no icon all read correctly on their own.',
        ].join('\n'),
      },
    },
  },
  render: () => (
    <div className="grid max-w-2xl gap-2">
      <Alert tone="warning" title="Soft" onDismiss={() => undefined}>
        Default, inside content.
      </Alert>
      <Alert tone="warning" variant="outline" title="Outline">
        On busy backgrounds.
      </Alert>
      <Alert tone="danger" variant="solid" title="Solid">
        Blocking problems only.
      </Alert>
      <Alert
        tone="info"
        variant="banner"
        title="Banner · full width, top of the page"
        actions={
          <Button size="xs" variant="secondary">
            Review
          </Button>
        }
      />
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
    <Card padded className="max-w-md space-y-3">
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
    </Card>
  ),
};

export const PageSkeleton: Story = {
  name: 'Page skeleton',
  parameters: {
    docs: {
      description: {
        story:
          '`shape="page"`: a page in `PageHeader`\'s measurements while it loads — the trail, the title and its line, the tab row when the page has tabs, and the body — so nothing under the header moves when the page arrives.',
      },
    },
  },
  render: () => <Skeleton shape="page" breadcrumb tabs={4} className="max-w-3xl" />,
};

export const EmptyStates: Story = {
  name: 'Empty states',
  parameters: {
    docs: {
      description: {
        story:
          'Different reasons for emptiness deserve different words: nothing yet, nothing matching a search, and nothing because the work has not started. Only the search offers to clear it, and only the invitation takes the accent.',
      },
    },
  },
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13.75rem),1fr))] gap-3">
      <Card padded>
        <EmptyState
          className="p-1.5"
          icon={<Inbox />}
          title="Nothing to approve"
          description="New requests will show up here."
        />
      </Card>
      <Card padded>
        <EmptyState
          className="p-1.5"
          icon={<SearchX />}
          title="No matches for “Priyaa”"
          description="Check the spelling or search by email."
          action={
            <Button variant="secondary" size="sm">
              Clear search
            </Button>
          }
        />
      </Card>
      <Card padded>
        <EmptyState
          className="p-1.5"
          tone="accent"
          icon={<UserPlus />}
          title="Invite your team"
          description="Add people to start tracking time off."
          action={<Button size="sm">Invite</Button>}
        />
      </Card>
    </div>
  ),
};
