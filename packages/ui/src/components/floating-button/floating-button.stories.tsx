import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowRight, Calendar, Plus, Receipt, Sparkles, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { Card } from '../card/card';
import { FloatingButton, SpeedDial as Dial } from './floating-button';

const meta = {
  title: 'Components/Floating button',
  component: FloatingButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'The single most important action on a screen, floating above the content. One per screen, never destructive.',
          '',
          'At a desk it carries one global task, such as Ask or New request, pinned to the bottom right. On a phone it floats above the tab bar, where the thumb already is.',
          '',
          'It does not position itself: the page decides the corner, because only the page knows what else is pinned there. An icon-only button needs an `aria-label`; an extended one is named by its label, and keeps that name while `collapsed`.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    variant: {
      description:
        '`primary` by default. `invert` for a global assistant that sits apart from the page’s own accent.',
      control: 'inline-radio',
      options: ['primary', 'tinted', 'surface', 'invert'],
      table: {
        type: { summary: "'primary' | 'tinted' | 'surface' | 'invert'" },
        defaultValue: { summary: 'primary' },
        category: 'Appearance',
      },
    },
    size: {
      description: '40, 56 or 96px. `md` is the default and the one to use.',
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    shape: {
      control: 'inline-radio',
      options: ['circle', 'rounded'],
      table: {
        type: { summary: "'circle' | 'rounded'" },
        defaultValue: { summary: 'circle' },
        category: 'Appearance',
      },
    },
    label: {
      description: 'Makes it an extended button.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    collapsed: {
      description: 'Folds an extended button to its icon, for "shrinks as you scroll".',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    icon: { control: false, table: { type: { summary: 'ReactNode' }, category: 'Content' } },
  },
  args: { icon: <Plus aria-hidden="true" />, 'aria-label': 'New request' },
} satisfies Meta<typeof FloatingButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-end gap-6">
      {(
        [
          ['sm', 'Small · 40'],
          ['md', 'Regular · 56'],
          ['lg', 'Large · 96'],
        ] as const
      ).map(([size, caption]) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <FloatingButton {...args} size={size} />
          <p className="text-sm text-fg-muted">{caption}</p>
        </div>
      ))}
    </div>
  ),
};

export const Extended: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <FloatingButton icon={<Plus aria-hidden="true" />} label="New request" />
      <FloatingButton icon={<Sparkles aria-hidden="true" />} label="Ask Reach" variant="invert" />
    </div>
  ),
};

export const Colours: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3.5">
      {(['primary', 'tinted', 'surface', 'invert'] as const).map((variant) => (
        <FloatingButton
          key={variant}
          {...args}
          variant={variant}
          aria-label={`New request, ${variant}`}
        />
      ))}
    </div>
  ),
};

export const Shapes: Story = {
  render: (args) => (
    <div className="flex items-end gap-6">
      <div className="flex flex-col items-center gap-2">
        <FloatingButton {...args} />
        <p className="text-sm text-fg-muted">Circle · default</p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <FloatingButton {...args} shape="rounded" aria-label="New request, rounded" />
        <p className="text-sm text-fg-muted">Rounded square</p>
      </div>
    </div>
  ),
};

export const ShrinksAsYouScroll: Story = {
  name: 'Shrinks as you scroll',
  parameters: {
    docs: {
      description: {
        story:
          'The label collapses when scrolling down and returns when scrolling up. The page owns the scroll listener and passes `collapsed`; press the button here to fold it.',
      },
    },
  },
  render: function ShrinkStory() {
    const [folded, setFolded] = useState(true);
    return (
      <div className="flex items-center gap-4.5">
        <div className="flex flex-col items-center gap-2">
          <FloatingButton icon={<Plus aria-hidden="true" />} label="New request" />
          <p className="text-sm text-fg-muted">At rest</p>
        </div>
        <ArrowRight aria-hidden="true" className="size-5 text-fg-subtle" />
        <div className="flex flex-col items-center gap-2">
          <FloatingButton
            icon={<Plus aria-hidden="true" />}
            label="New request"
            collapsed={folded}
            onClick={() => {
              setFolded(!folded);
            }}
          />
          <p className="text-sm text-fg-muted">Scrolling down</p>
        </div>
      </div>
    );
  },
};

const dial = [
  { icon: Calendar, label: 'Time off' },
  { icon: Receipt, label: 'Expense' },
  { icon: UserPlus, label: 'Invite person' },
];

export const SpeedDial: Story = {
  name: 'Speed dial',
  parameters: {
    docs: {
      description: {
        story:
          'Three actions at most, fanned out above the button. The scrim dims the page so the actions are the only thing on it, and tapping it closes the dial. Escape closes it too, and focus returns to the button.',
      },
    },
  },
  render: function SpeedDialStory() {
    const [picked, setPicked] = useState<string | null>(null);
    return (
      <div className="flex h-80 w-72 flex-col items-end justify-between p-5">
        <p aria-live="polite" className="self-start text-sm text-fg-muted">
          {picked ?? 'Open the dial.'}
        </p>
        <Dial
          icon={<Plus aria-hidden="true" />}
          aria-label="Quick actions"
          actions={dial.map(({ icon: Icon, label }) => ({
            label,
            icon: <Icon aria-hidden="true" />,
            onSelect: () => {
              setPicked(label);
            },
          }))}
        />
      </div>
    );
  },
};

export const InContext: Story = {
  name: 'In context',
  parameters: { layout: 'padded' },
  render: () => (
    <div className="relative h-80 overflow-hidden rounded-xl bg-canvas p-5 shadow-[inset_0_0_0_1px_var(--color-border)]">
      <div className="flex flex-col gap-3">
        <div className="h-4.5 w-2/5 rounded-xs bg-surface-active" />
        <div className="h-2.5 w-3/4 rounded-xs bg-surface-sunken" />
        <Card className="h-20" />
        <Card className="h-20" />
      </div>
      <FloatingButton
        icon={<Sparkles aria-hidden="true" />}
        label="Ask Reach"
        className="absolute end-5 bottom-5"
      />
    </div>
  ),
};

export const Dont: Story = {
  name: 'Don’t',
  parameters: { layout: 'padded' },
  render: () => (
    <div className="grid grid-cols-2 gap-2.5">
      <Card className="flex flex-col gap-2 p-3.5">
        <div className="flex gap-2">
          <FloatingButton size="sm" icon={<Plus aria-hidden="true" />} aria-label="New request" />
          <FloatingButton size="sm" icon={<Sparkles aria-hidden="true" />} aria-label="Ask" />
        </div>
        <p className="text-sm font-semibold">Two floating buttons</p>
        <p className="text-xs font-semibold text-danger-fg">Pick one</p>
      </Card>
      <Card className="flex flex-col gap-2 p-3.5">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-full bg-danger-solid text-fg-on-accent shadow-lg"
        >
          <Trash2 className="size-4.5" />
        </span>
        <p className="text-sm font-semibold">Destructive action</p>
        <p className="text-xs font-semibold text-danger-fg">Never float delete</p>
      </Card>
    </div>
  ),
};
