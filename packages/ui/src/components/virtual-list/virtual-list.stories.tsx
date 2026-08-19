import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { VirtualList, type VirtualListProps } from './virtual-list';

interface Person {
  id: string;
  name: string;
  role: string;
  status: 'Active' | 'On leave';
}

/*
 * Typed to `Person` rather than inferred with `satisfies`.
 *
 * `VirtualList` is generic, and `satisfies Meta<typeof VirtualList>` resolves
 * its parameter to `unknown`, which then rejects every `renderItem` written
 * against a real row type. Naming the props explicitly also stops `satisfies`
 * demanding args the stories deliberately supply through `render`.
 */
const meta: Meta<VirtualListProps<Person>> = {
  title: 'Components/VirtualList',
  component: VirtualList,
  parameters: {
    layout: 'padded',
    controls: {
      /*
       * The dataset never becomes an arg.
       *
       * Storybook renders an object control for every arg, and that control is
       * a JSON tree with one node per entry. With `items` in `args`, the
       * twenty-thousand-item story put 20,000 list items into the docs page and
       * locked the tab: the component was mounting fifteen rows while the
       * Controls panel beside it mounted the entire array.
       *
       * Every story below builds its data inside `render`, so it stays out of
       * `args` entirely. This exclusion is the second lock on the same door.
       */
      exclude: ['items', 'renderItem', 'itemKey'],
    },
    docs: {
      description: {
        component: [
          'A long list with only the visible part mounted.',
          '',
          '### Why this is not a prop on `ScrollArea`',
          '',
          '`ScrollArea` takes arbitrary children. A virtualizer needs to know how many items there are and roughly how tall each one is, and a container that receives `{children}` knows neither. Anything offering to "virtualize a scroll area" is really asking for the list, so this asks for it directly.',
          '',
          '### The count has to survive virtualization',
          '',
          'Only a window is mounted, so the DOM stops stating how many items exist. `aria-setsize` and `aria-posinset` carry the real total and position. Without them a screen reader announces "item 3 of 20" in a list of twenty thousand, which is worse than not virtualizing at all.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

function makePeople(count: number, offset = 200_000): Person[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `EMP-${String(offset + index)}`,
    name: `Employee ${String(index + 1)}`,
    role: ['Engineer', 'Designer', 'Analyst', 'Manager'][index % 4] ?? 'Engineer',
    status: index % 7 === 0 ? 'On leave' : 'Active',
  }));
}

function PersonRow({ person }: { person: Person }): JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2">
      <Avatar size="sm" name={person.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{person.name}</p>
        <p className="truncate text-xs text-fg-subtle">
          {person.role} · {person.id}
        </p>
      </div>
      <Badge tone={person.status === 'Active' ? 'success' : 'warning'}>{person.status}</Badge>
    </div>
  );
}

type Story = StoryObj<VirtualListProps<Person>>;

/** Twenty thousand people, a couple of dozen elements. */
export const TwentyThousand: Story = {
  render: function TwentyThousandStory() {
    const people = makePeople(20_000);
    return (
      <VirtualList
        items={people}
        label="Everyone"
        itemKey={(person) => person.id}
        estimateItemHeight={56}
        className="h-96 rounded-lg border border-border"
        renderItem={(person) => <PersonRow person={person} />}
      />
    );
  },
};

/**
 * Items of different heights, measured rather than assumed.
 *
 * `estimateItemHeight` is only a first guess, used to size the scrollbar before
 * anything is painted. Each item reports its real height once mounted, so a
 * list of mixed-height cards settles to an accurate scroll range instead of
 * drifting as you go.
 */
export const VariableHeights: Story = {
  render: function VariableHeightsStory() {
    const notes = makePeople(5000, 300_000);
    return (
      <VirtualList
        items={notes}
        label="Notes"
        itemKey={(note) => note.id}
        estimateItemHeight={72}
        className="h-96 rounded-lg border border-border"
        renderItem={(note, index) => (
          <div className="border-b border-border px-3 py-2">
            <p className="text-sm font-medium text-fg">{note.name}</p>
            {/* Deterministic, so the story renders the same every time. */}
            <p className="text-xs text-fg-muted">{'A short line. '.repeat((index % 5) + 1)}</p>
          </div>
        )}
      />
    );
  },
};

/**
 * Reachable without a mouse.
 *
 * The list is a focusable region, so Tab lands on it and the arrow keys, Page
 * Up, Page Down, Home and End scroll it. A scroll container that only responds
 * to a wheel is unreachable for anyone who does not use one, and axe is right
 * to flag it.
 */
export const Keyboard: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Tab to the list, then use the arrow keys. Focus stays on the region rather than moving through three thousand items, which is what a long list wants: stepping through every row to reach the end is not navigation.',
      },
    },
  },
  render: function KeyboardStory() {
    const people = makePeople(3000, 400_000);
    return (
      <VirtualList
        items={people}
        label="Everyone, keyboard reachable"
        itemKey={(person) => person.id}
        estimateItemHeight={40}
        className="h-64 rounded-lg border border-border"
        renderItem={(person) => (
          <p className="border-b border-border px-3 py-2 text-sm text-fg">{person.name}</p>
        )}
      />
    );
  },
};

/** Nothing to show, which is a state a list spends real time in. */
export const Empty: Story = {
  render: function EmptyStory() {
    // Named rather than inlined: an empty array literal infers `never[]`, so
    // the element type has to come from somewhere, and a declaration says it
    // where a cast only asserts it.
    const noPeople: readonly Person[] = [];
    return (
      <VirtualList
        items={noPeople}
        label="Everyone"
        itemKey={(person) => person.id}
        className="h-48 rounded-lg border border-border"
        empty="No one matches these filters."
        renderItem={(person) => <p>{person.name}</p>}
      />
    );
  },
};
