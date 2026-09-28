import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell, CalendarClock, Download } from 'lucide-react';

import { Button } from '../button/button';
import { Kbd } from '../kbd/kbd';
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
    content: 'Export as CSV',
    side: 'top',
    align: 'center',
    children: (
      <Button variant="secondary" startIcon={<Download />} aria-label="Export as CSV">
        {null}
      </Button>
    ),
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
        <Tooltip key={side} side={side} content={`${side.charAt(0).toUpperCase()}${side.slice(1)}`}>
          <Button variant="secondary">{side}</Button>
        </Tooltip>
      ))}
    </div>
  ),
};

export const OnAnIconButton: Story = {
  name: 'On an icon-only control',
  args: { content: 'Notifications', open: true },
  parameters: {
    docs: {
      description: {
        story:
          'The tooltip text matches the `aria-label`, deliberately. The tooltip is for sighted pointer users; the label is what a screen reader and a touch user actually get. The shortcut sits on its own line.',
      },
    },
  },
  render: (args) => (
    <Tooltip
      {...args}
      shortcut={
        <>
          <Kbd>G</Kbd>
          <Kbd>N</Kbd>
        </>
      }
    >
      <Button variant="secondary" startIcon={<Bell />} aria-label="Notifications">
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
          'Tooltips name things. They do not explain them. If it needs a sentence, use a popover or put the text on the page: a tooltip does not exist on touch and vanishes on pointer-out.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap gap-8">
      <div className="space-y-3">
        <p className="text-xs font-semibold text-fg-muted">Don’t</p>
        <Tooltip content="Carry-over days expire on 31 March unless your manager extends them, see the policy for details.">
          <Button variant="secondary">Carry-over</Button>
        </Tooltip>
      </div>
      <div className="space-y-3">
        <p className="text-xs font-semibold text-fg-muted">Do</p>
        <Tooltip content="Carry-over">
          <Button variant="secondary" startIcon={<CalendarClock />} aria-label="Carry-over">
            {null}
          </Button>
        </Tooltip>
      </div>
    </div>
  ),
};
