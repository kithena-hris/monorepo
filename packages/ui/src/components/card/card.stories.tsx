import type { Meta, StoryObj } from '@storybook/react-vite';
import { Ellipsis } from 'lucide-react';

import { Alert } from '../feedback/feedback';
import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Money } from '../money/money';
import { Stat } from '../stat/stat';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

const meta = {
  title: 'Components/Card',
  component: Card,
  subcomponents: { CardHeader, CardTitle, CardDescription, CardContent, CardFooter },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A surface that groups related content.',
          '',
          '**Default to `raised`.** A white surface with a hairline shadow separates from the grey canvas without adding weight, and a screen where everything is elevated has no hierarchy left to spend. `outline` is a line and no fill, for grouping on a surface that is already white; `fill` is a grey panel inside a panel; `elevated` is for things that genuinely float over their context. Do not nest cards inside cards.',
          '',
          '`outlined` and `sunken` are the earlier names for `raised` and `fill`, and still work.',
          '',
          '### Composition',
          '',
          '```tsx',
          '<Card>',
          '  <CardHeader>',
          '    <div><CardTitle>…</CardTitle><CardDescription>…</CardDescription></div>',
          '    <Button variant="ghost" … />',
          '  </CardHeader>',
          '  <CardContent>…</CardContent>',
          '  <CardFooter>…</CardFooter>',
          '</Card>',
          '```',
          '',
          '`CardHeader` is a two-slot row: content on the left, actions on the right. Use `padded` on `Card` only when you are *not* using the header/content/footer parts, which bring their own spacing.',
          '',
          '`CardTitle` renders an `<h3>`. If that is the wrong level for the page, override it: heading order is document structure, not decoration.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    variant: {
      description: 'How the surface separates itself from the canvas.',
      control: 'inline-radio',
      options: ['raised', 'outline', 'fill', 'elevated'],
      table: {
        type: { summary: "'raised' | 'outline' | 'fill' | 'elevated'" },
        defaultValue: { summary: 'raised' },
        category: 'Appearance',
      },
    },
    interactive: {
      description:
        'The whole card is a target: hover lifts it. Only when the card really is a link or a button.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Behaviour',
      },
    },
    padded: {
      description:
        'Adds uniform padding. For simple cards with no header or footer parts, which carry their own.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Layout',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { variant: 'raised', padded: true },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Card {...args} className="max-w-sm">
      <h3 className="font-display text-lg font-bold tracking-tight">Time off</h3>
      <p className="mt-1 text-sm text-fg-muted">14.5 days left this year</p>
    </Card>
  ),
};

export const Variants: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'In dark mode `elevated` reads through surface lightness rather than shadow, because a shadow on a near-black canvas is invisible. Flip the theme in the toolbar to see it.',
      },
    },
  },
  render: () => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-3">
      {(
        [
          ['raised', 'The everyday default.', false],
          ['outline', 'On a white surface.', false],
          ['fill', 'A panel inside a panel.', false],
          ['elevated', 'Floats over its context.', false],
          ['raised', 'Hover lifts it.', true],
        ] as const
      ).map(([variant, note, interactive]) => (
        <Card key={note} variant={variant} padded interactive={interactive}>
          <p className="text-base font-semibold capitalize">
            {interactive ? 'Interactive' : variant}
          </p>
          <p className="mt-1 text-sm text-fg-muted">{note}</p>
        </Card>
      ))}
    </div>
  ),
};

export const NeedsDoing: Story = {
  name: 'Needs doing',
  parameters: {
    docs: {
      description: {
        story:
          'A card that needs doing is an `Alert` with its action inside, not a card painted yellow. A figure that is the point of the screen can sit on the accent.',
      },
    },
  },
  render: () => (
    <div className="flex max-w-md flex-col gap-2.5">
      <Alert
        tone="warning"
        title="Right to work expires in 14 days"
        actions={
          <Button variant="primary" size="sm">
            Upload
          </Button>
        }
      >
        Upload a new visa for Lucas Moreau before 12 Oct.
      </Alert>
      <Card padded className="bg-accent-solid text-fg-on-accent">
        <p className="text-[0.875rem] font-semibold">Vacation left</p>
        <p className="mt-2.5 font-display text-[2.75rem] leading-none font-bold tracking-tight tabular-nums">
          14.5 <span className="text-lg">days</span>
        </p>
      </Card>
    </div>
  ),
};

export const Attention: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`tone="attention"`: this card holds something wanted and missing. Its one-pixel warning edge is the reminder; the badge and the words inside are the signal, because an edge is colour alone.',
      },
    },
  },
  render: () => (
    <Card tone="attention" className="max-w-md">
      <CardHeader>
        <div>
          <CardTitle>Identification &amp; right to work</CardTitle>
          <CardDescription>What the law needs on file before a first payslip.</CardDescription>
        </div>
        <Badge tone="attention">2 missing</Badge>
      </CardHeader>
      <CardContent>
        <Button variant="secondary" size="sm">
          Fill in
        </Button>
      </CardContent>
    </Card>
  ),
};

export const StatTile: Story = {
  name: 'Stat tile',
  parameters: {
    docs: {
      description: {
        story:
          'The most common use. The number is the point, so it gets the size, and tabular figures, so a row of tiles does not visibly jitter as values update.',
      },
    },
  },
  render: () => (
    // The design's tile grid: 150px columns under a finger, 170 at a desk.
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10.625rem),1fr))] gap-3 touch:grid-cols-[repeat(auto-fit,minmax(min(100%,9.375rem),1fr))]">
      <Stat
        label="Headcount"
        value="912"
        delta="+18"
        deltaLabel="this quarter"
        direction="up"
        sentiment="positive"
      />
      <Stat
        label="Monthly payroll"
        value={<Money minorUnits="983450000" currency="EUR" locale="en-IE" />}
        description="Base salary only"
      />
      <Stat label="Pending approvals" value="7" description="Oldest is 4 days" />
    </div>
  ),
};

export const Composed: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Header, content and footer together. The key/value block is a real `<dl>`, so a screen reader hears "Base salary, €14,200.00" rather than two unrelated strings.',
      },
    },
  },
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Avatar size="lg" name="Grace Hopper" />
          <div>
            <CardTitle>Grace Hopper</CardTitle>
            <CardDescription>Principal Engineer &middot; Platform</CardDescription>
          </div>
        </div>
        <Button variant="ghost" size="sm" startIcon={<Ellipsis />} aria-label="More actions">
          {null}
        </Button>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-fg-subtle">Employee number</dt>
            <dd className="mt-0.5 font-medium" data-numeric>
              EMP-004182
            </dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Hired</dt>
            <dd className="mt-0.5 font-medium">
              <time dateTime="2019-04-01">1 April 2019</time>
            </dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Base salary</dt>
            <dd className="mt-0.5 font-medium">
              <Money minorUnits="1420000" currency="EUR" locale="en-IE" />
            </dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Status</dt>
            <dd className="mt-0.5">
              <Badge dot tone="success" size="sm">
                Active
              </Badge>
            </dd>
          </div>
        </dl>
      </CardContent>
      <CardFooter>
        <Button variant="ghost">View history</Button>
        <Button variant="primary">Edit profile</Button>
      </CardFooter>
    </Card>
  ),
};
