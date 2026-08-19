import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoreHorizontal } from 'lucide-react';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Money } from '../money/money';
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
          '**Default to `outlined`.** A line separates without adding weight, and a screen where everything is elevated has no hierarchy left to spend. Reserve `elevated` for things that genuinely float over their context.',
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
      options: ['outlined', 'elevated', 'sunken'],
      table: {
        type: { summary: "'outlined' | 'elevated' | 'sunken'" },
        defaultValue: { summary: 'outlined' },
        category: 'Appearance',
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
  args: { variant: 'outlined', padded: true },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Card {...args} className="max-w-sm">
      <p className="text-base font-medium">Pending approvals</p>
      <p className="mt-1 text-sm text-fg-muted">Seven requests are waiting on you.</p>
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
    <div className="grid gap-4 sm:grid-cols-3">
      {(
        [
          ['outlined', 'The everyday default.'],
          ['elevated', 'Floats over its context.'],
          ['sunken', 'A panel inside a panel.'],
        ] as const
      ).map(([variant, note]) => (
        <Card key={variant} variant={variant} padded>
          <p className="text-base font-medium capitalize">{variant}</p>
          <p className="mt-1 text-sm text-fg-muted">{note}</p>
        </Card>
      ))}
    </div>
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
    <div className="grid gap-4 sm:grid-cols-3">
      <Card padded>
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">Headcount</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">912</p>
        <p className="mt-1 text-xs text-fg-muted">+18 this quarter</p>
      </Card>
      <Card padded>
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
          Monthly payroll
        </p>
        <p className="mt-2 text-2xl font-semibold">
          <Money minorUnits="983450000" currency="EUR" locale="en-IE" />
        </p>
        <p className="mt-1 text-xs text-fg-muted">Base salary only</p>
      </Card>
      <Card padded>
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
          Pending approvals
        </p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">7</p>
        <p className="mt-1 text-xs text-fg-muted">Oldest is 4 days</p>
      </Card>
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
        <Button variant="ghost" size="sm" startIcon={<MoreHorizontal />} aria-label="More actions">
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
