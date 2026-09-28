import type { Meta, StoryObj } from '@storybook/react-vite';
import { Code, MessageCircle } from 'lucide-react';

import { Avatar, AvatarGroup } from '../avatar/avatar';
import { Button } from '../button/button';
import { BarChart } from '../chart/chart';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card';

const meta = {
  title: 'Components/Hover card',
  component: HoverCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A preview of a person or record when you hover a name. It opens after a short rest, the same as every hover-opened surface, and stays open while the pointer is over it. On a phone, long-press opens the preview and its actions.',
          '',
          'Built on `Popover`, not Radix `HoverCard`, which is pointer-only by design. Here keyboard focus on the trigger opens the same peek without taking focus, Escape closes it, and a long-press under a finger opens it and moves focus in.',
          '',
          'The card is a preview. Anything in it must also be reachable where the trigger leads, because a keyboard user tabbing past a name never enters the card. For commands, use a `DropdownMenu`.',
        ].join('\n'),
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="min-h-80">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    openDelay: {
      description: 'Milliseconds the pointer rests on the trigger before the card opens.',
      control: 'number',
      table: { defaultValue: { summary: '50' }, category: 'Behaviour' },
    },
    closeDelay: {
      description:
        'Milliseconds before closing once the pointer has left the trigger and the card.',
      control: 'number',
      table: { defaultValue: { summary: '80' }, category: 'Behaviour' },
    },
    defaultOpen: { control: 'boolean', table: { category: 'State' } },
  },
  args: { defaultOpen: true },
} satisfies Meta<typeof HoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

function PersonCard({
  name,
  role,
  team,
  presence,
  rows,
}: {
  name: string;
  role: string;
  team: string;
  presence: 'success' | 'info';
  rows: [string, string][];
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="relative">
          <Avatar name={name} size="xl" className="size-12" />
          <span
            aria-hidden="true"
            className={
              presence === 'success'
                ? 'absolute end-0 bottom-0 size-3.5 rounded-full bg-success-solid ring-2 ring-surface'
                : 'absolute end-0 bottom-0 size-3.5 rounded-full bg-info ring-2 ring-surface'
            }
          />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-md font-bold">{name}</p>
          <p className="text-sm text-fg-muted">
            {role} · {team}
          </p>
        </div>
      </div>
      <dl className="flex flex-col">
        {rows.map(([term, value], index) => (
          <div
            key={term}
            className={
              index < rows.length - 1
                ? 'flex min-h-11 items-center justify-between gap-4 shadow-[inset_0_-1px_0_var(--color-border)]'
                : 'flex min-h-11 items-center justify-between gap-4'
            }
          >
            <dt className="text-sm text-fg-muted">{term}</dt>
            <dd className="text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex gap-2">
        <Button size="sm" startIcon={<MessageCircle aria-hidden="true" />} className="flex-1">
          Message
        </Button>
        <Button variant="primary" size="sm" className="flex-1">
          Profile
        </Button>
      </div>
    </div>
  );
}

export const Playground: Story = {
  render: (args) => (
    <p className="text-base">
      Approved by{' '}
      <HoverCard {...args}>
        <HoverCardTrigger
          href="#jonas"
          className="font-semibold text-accent-fg underline-offset-3 hover:underline"
        >
          Jonas Weber
        </HoverCardTrigger>
        <HoverCardContent aria-label="Jonas Weber">
          <PersonCard
            name="Jonas Weber"
            role="Engineering manager"
            team="Platform"
            presence="success"
            rows={[
              ['Local time', '14:32 in Berlin'],
              ['Manager', 'Nora Becker'],
            ]}
          />
        </HoverCardContent>
      </HoverCard>
    </p>
  ),
};

export const SomeoneAway: Story = {
  name: 'Someone away',
  render: (args) => (
    <p className="text-base">
      Covered by{' '}
      <HoverCard {...args}>
        <HoverCardTrigger
          href="#amara"
          className="font-semibold text-accent-fg underline-offset-3 hover:underline"
        >
          Amara Okafor
        </HoverCardTrigger>
        <HoverCardContent aria-label="Amara Okafor">
          <PersonCard
            name="Amara Okafor"
            role="People partner"
            team="People"
            presence="info"
            rows={[
              ['Away', 'Back Mon 21 Oct'],
              ['Manager', 'Nora Becker'],
            ]}
          />
        </HoverCardContent>
      </HoverCard>
    </p>
  ),
};

export const OnATeam: Story = {
  name: 'On a team',
  parameters: {
    docs: {
      description: {
        story:
          'A record rather than a person: the team’s size, its people and how it has grown. On a phone the same card opens on a long-press.',
      },
    },
  },
  render: (args) => (
    <p className="text-base">
      Moved to{' '}
      <HoverCard {...args}>
        <HoverCardTrigger
          href="#engineering"
          className="font-semibold text-accent-fg underline-offset-3 hover:underline"
        >
          Engineering
        </HoverCardTrigger>
        <HoverCardContent aria-label="Engineering">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar
                name="Engineering"
                shape="rounded"
                size="xl"
                className="size-11"
                fallback={<Code aria-hidden="true" className="size-5" />}
              />
              <div className="flex flex-col gap-0.5">
                <p className="text-md font-bold">Engineering</p>
                <p className="text-sm text-fg-muted">124 people · Jonas Weber</p>
              </div>
            </div>
            <AvatarGroup max={6} total={124}>
              {[
                'Priya Shah',
                'Jonas Weber',
                'Amara Okafor',
                'Mei Tanaka',
                'Lucas Martin',
                'Yuki Sato',
              ].map((name) => (
                <Avatar key={name} name={name} size="sm" />
              ))}
            </AvatarGroup>
            <BarChart
              label="Headcount by quarter"
              data={[
                { label: 'Q1', value: 110 },
                { label: 'Q2', value: 116 },
                { label: 'Q3', value: 124 },
              ]}
              height={60}
            />
          </div>
        </HoverCardContent>
      </HoverCard>
    </p>
  ),
};
