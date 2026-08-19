import type { Meta, StoryObj } from '@storybook/react-vite';
import { Info } from 'lucide-react';

import { Button } from '../button/button';
import { Tooltip } from './tooltip';

const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A tooltip is never the only place information lives: it does not appear on touch, and it disappears the moment the pointer leaves.',
          '',
          'Never put a validation message, a price, or the meaning of an icon-only control in one. For the last case give the control an `aria-label` as well, which is what a screen reader will actually read.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    content: {
      description: 'The hint. One short phrase, a tooltip that needs a paragraph is a popover.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    side: {
      description: 'Preferred side. Flips automatically when there is no room.',
      control: 'inline-radio',
      options: ['top', 'right', 'bottom', 'left'],
      table: {
        type: { summary: "'top' | 'right' | 'bottom' | 'left'" },
        defaultValue: { summary: 'top' },
        category: 'Placement',
      },
    },
    align: {
      description: 'Alignment along the chosen side.',
      control: 'inline-radio',
      options: ['start', 'center', 'end'],
      table: {
        type: { summary: "'start' | 'center' | 'end'" },
        defaultValue: { summary: 'center' },
        category: 'Placement',
      },
    },
    delayDuration: {
      description:
        'Milliseconds before opening on hover. Long enough not to fire while crossing the control, short enough not to feel broken.',
      control: { type: 'number', min: 0, max: 1000, step: 50 },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '200 (from the provider)' },
        category: 'Behaviour',
      },
    },
    open: {
      description: 'Controlled open state. Mostly useful for tests and screenshots.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    onOpenChange: { action: 'open changed', table: { category: 'Events' } },
  },
  args: {
    content: 'Accrued to 31 August 2026',
    side: 'top',
    align: 'center',
    children: <Button>Balance</Button>,
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sides: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The side is a preference, not a guarantee: near a viewport edge the tooltip flips rather than clipping.',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-3">
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Tooltip key={side} side={side} content={`Opens ${side}`}>
          <Button variant="secondary">{side}</Button>
        </Tooltip>
      ))}
    </div>
  ),
};

export const OnAnIconButton: Story = {
  name: 'On an icon-only control',
  parameters: {
    docs: {
      description: {
        story:
          'The `aria-label` and the tooltip say the same thing, deliberately. The tooltip is for sighted pointer users; the label is what a screen reader and a touch user actually get.',
      },
    },
  },
  render: () => (
    <Tooltip content="How the balance is accrued">
      <Button variant="ghost" startIcon={<Info />} aria-label="How the balance is accrued">
        {null}
      </Button>
    </Tooltip>
  ),
};

export const WhatNotToPutInOne: Story = {
  name: 'What not to put in one',
  parameters: {
    docs: {
      description: {
        story:
          'A tooltip does not exist on touch and vanishes on pointer-out. Anything the user must be able to re-read, a validation message, an amount, a policy: belongs in the layout.',
      },
    },
  },
  render: () => (
    <div className="grid max-w-xl gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-danger-border bg-danger-subtle p-4">
        <p className="text-2xs font-semibold tracking-wide uppercase text-danger-fg">Wrong</p>
        <div className="mt-3">
          <Tooltip content="Must be after the first day">
            <Button variant="secondary">Last day</Button>
          </Tooltip>
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          The validation message disappears the moment the pointer leaves, and never appears at all
          on a phone.
        </p>
      </div>
      <div className="rounded-lg border border-success-border bg-success-subtle p-4">
        <p className="text-2xs font-semibold tracking-wide uppercase text-success-fg">Right</p>
        <div className="mt-3 space-y-1">
          <Button variant="secondary">Last day</Button>
          <p className="text-xs font-medium text-danger-fg">Must be after the first day.</p>
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          In the layout, via `FieldError`, where it stays readable.
        </p>
      </div>
    </div>
  ),
};
