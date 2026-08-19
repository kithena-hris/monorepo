import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState, type JSX } from 'react';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Separator } from '../separator/separator';
import { VirtualList } from '../virtual-list/virtual-list';
import { ScrollArea } from './scroll-area';

const meta = {
  title: 'Components/ScrollArea',
  component: ScrollArea,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A scroll container with a scrollbar that exists on every platform.',
          '',
          '### The problem it solves',
          '',
          'macOS hides overlay scrollbars until you scroll. On a desktop that means a scrollable panel gives *no hint at all* that it scrolls, the content simply appears to end. This renders a bar that is always sized and only fades, so the affordance survives.',
          '',
          '### What it does not do',
          '',
          'It does not replace native scrolling. The viewport is a real scroll container, so momentum, rubber-banding, keyboard paging, find-in-page and screen-reader scroll-into-view all behave exactly as they should. Custom-scroll libraries that reimplement the physics get all five of those wrong on a phone.',
          '',
          '`overscroll-contain` stops a flick inside the panel from scrolling the page behind it once it hits the end, the "I scrolled the list and the whole app moved" bug.',
          '',
          '### Height goes on the viewport',
          '',
          '`viewportClassName` sets the height, not `className`. The root is `overflow: hidden` and the viewport is what actually scrolls; putting the height on the root gives you a clipped panel with no scrollbar.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    orientation: {
      description:
        'Which bars to render. `both` is for a wide table inside a fixed panel: rare, and usually a sign the table wants its own container.',
      control: 'inline-radio',
      options: ['vertical', 'horizontal', 'both'],
      table: {
        type: { summary: "'vertical' | 'horizontal' | 'both'" },
        defaultValue: { summary: 'vertical' },
        category: 'Appearance',
      },
    },
    viewportClassName: {
      description: 'Classes for the scrolling element. **The height belongs here.**',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Appearance' },
    },
    type: {
      description:
        '`hover` shows the bar on hover, `scroll` while scrolling, `auto` like a native overflow container, `always` never hides it.',
      control: 'inline-radio',
      options: ['auto', 'always', 'scroll', 'hover'],
      table: {
        type: { summary: "'auto' | 'always' | 'scroll' | 'hover'" },
        defaultValue: { summary: 'hover' },
        category: 'Behaviour',
      },
    },
    scrollHideDelay: {
      description:
        'Milliseconds before the bar fades. 600 is long enough to still be there when a flick ends.',
      control: { type: 'number' },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '600' },
        category: 'Behaviour',
      },
    },
    className: {
      description: 'Classes for the root: border, radius, width. Not the height.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { orientation: 'vertical', type: 'hover' },
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A row, hoisted to module scope.
 *
 * Declared inside the story's render it would be a new component type on every
 * render, and React would remount all 2000 rows instead of updating them,
 * which is precisely the cost this story exists to compare.
 */
function Person({ name, role }: { name: string; role: string }): JSX.Element {
  return (
    <div data-person className="border-b border-border px-3 py-2">
      <p className="text-sm text-fg">{name}</p>
      <p className="text-xs text-fg-subtle">{role}</p>
    </div>
  );
}

const people = Array.from({ length: 40 }, (_, i) => ({
  name: `Employee ${String(i + 1).padStart(2, '0')}`,
  team: ['Platform', 'Payroll', 'People Ops', 'Support'][i % 4] ?? 'Platform',
  status: i % 7 === 0 ? 'On leave' : 'Active',
}));

export const Playground: Story = {
  render: (args) => (
    <ScrollArea
      {...args}
      className="w-72 rounded-lg border border-border bg-surface"
      viewportClassName="h-72"
    >
      <div className="divide-y divide-border">
        {people.map((person) => (
          <div key={person.name} className="flex items-center gap-3 px-3 py-2.5">
            <Avatar size="sm" name={person.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base text-fg">{person.name}</p>
              <p className="text-xs text-fg-muted">{person.team}</p>
            </div>
            {person.status === 'On leave' ? (
              <Badge tone="warning" size="sm" dot>
                On leave
              </Badge>
            ) : null}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const Horizontal: Story = {
  args: { orientation: 'horizontal' },
  parameters: {
    docs: {
      description: {
        story:
          'A horizontal rail of cards. Horizontal scroll needs a *visible* bar more than vertical does: there is no scroll wheel for it, so without the affordance most people never discover the content.',
      },
    },
  },
  render: (args) => (
    <ScrollArea {...args} className="w-full max-w-xl rounded-lg border border-border bg-surface">
      <div className="flex gap-3 p-3">
        {['Platform', 'Payroll', 'People Ops', 'Support', 'Finance', 'Legal', 'Facilities'].map(
          (team) => (
            <div
              key={team}
              className="w-40 shrink-0 rounded-md border border-border bg-surface-sunken p-3"
            >
              <p className="text-base font-medium text-fg">{team}</p>
              <p className="mt-1 text-sm text-fg-muted">
                {Math.floor(Math.random() * 200) + 20} people
              </p>
            </div>
          ),
        )}
      </div>
    </ScrollArea>
  ),
};

export const AlwaysVisible: Story = {
  name: 'Always visible',
  args: { type: 'always' },
  parameters: {
    docs: {
      description: {
        story:
          'For a panel whose scrollability is not otherwise discoverable, a short list where the cut-off content happens to align with a border. The cost is a permanent 10px of visual noise, so it is not the default.',
      },
    },
  },
  render: (args) => (
    <ScrollArea
      {...args}
      className="w-72 rounded-lg border border-border bg-surface"
      viewportClassName="h-40"
    >
      <div className="space-y-2 p-3 text-sm text-fg-muted">
        {Array.from({ length: 12 }, (_, i) => (
          <p key={i}>Audit entry {i + 1}: record updated, effective 1 September 2026.</p>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const InsideAPanel: Story = {
  name: 'A fixed panel with a scrolling body',
  parameters: {
    docs: {
      description: {
        story:
          'The layout every detail panel wants: a header that stays, a body that scrolls, a footer that stays. The scroll area is the middle child of a flex column with `min-h-0`, without that minimum, the body pushes the footer off the bottom instead of scrolling.',
      },
    },
  },
  render: (args) => (
    <div className="flex h-96 max-w-sm flex-col rounded-lg border border-border bg-surface">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="text-base font-semibold text-fg">Approval queue</p>
        <p className="text-sm text-fg-muted">7 requests awaiting you</p>
      </div>

      <ScrollArea {...args} className="min-h-0 flex-1" viewportClassName="h-full">
        <div className="divide-y divide-border">
          {people.slice(0, 20).map((person) => (
            <div key={person.name} className="px-4 py-3">
              <p className="text-base text-fg">{person.name}</p>
              <p className="text-sm text-fg-muted">Annual leave · 3 days · from 14 September</p>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Separator />
      <div className="shrink-0 px-4 py-3 text-sm text-fg-muted">Showing 20 of 40</div>
    </div>
  ),
};

/**
 * The point at which a scroll area is the wrong tool.
 *
 * `ScrollArea` mounts everything it is given. That is exactly right for a
 * settings panel or a menu, and wrong for a list of twenty thousand people:
 * twenty thousand DOM nodes cost memory, make every style recalculation walk
 * the lot, and turn a theme toggle into a visible pause.
 *
 * `VirtualList` is the same scrolling box that mounts only the window in view.
 * It cannot be a prop on this component, because a container that receives
 * `{children}` has no way to know how many items it holds or how tall they are.
 *
 * Both panes below scroll identically. The count under each is the number of
 * elements actually in the document, read live.
 */
export const WhenToVirtualize: Story = {
  name: 'When to virtualize',
  parameters: {
    docs: {
      description: {
        story:
          'Left: `ScrollArea` with 2000 rows, all mounted. Right: `VirtualList` with the same 2000 rows, a couple of dozen mounted. Scroll either one. The difference is not visible, which is the point: it shows up in memory, in style recalculation, and in how long the first paint takes.',
      },
    },
  },
  render: function WhenToVirtualizeStory() {
    const manyPeople = Array.from({ length: 2000 }, (_, index) => ({
      id: `P-${String(index)}`,
      name: `Employee ${String(index + 1)}`,
      role: ['Engineer', 'Designer', 'Analyst'][index % 3] ?? 'Engineer',
    }));

    const [counts, setCounts] = useState({ plain: 0, virtual: 0 });
    const plainRef = useRef<HTMLDivElement | null>(null);
    const virtualRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      // Counted after paint, because before it both are empty and the
      // comparison would flatter whichever rendered second.
      const id = window.setTimeout(() => {
        setCounts({
          plain: plainRef.current?.querySelectorAll('[data-person]').length ?? 0,
          virtual: virtualRef.current?.querySelectorAll('[data-person]').length ?? 0,
        });
      }, 300);
      return () => {
        window.clearTimeout(id);
      };
    }, []);

    return (
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">ScrollArea</h3>
          <div ref={plainRef}>
            <ScrollArea className="h-72 rounded-lg border border-border">
              {manyPeople.map((person) => (
                <Person key={person.id} name={person.name} role={person.role} />
              ))}
            </ScrollArea>
          </div>
          <p className="mt-2 text-xs text-fg-subtle">
            {counts.plain} of 2000 rows in the document.
          </p>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">VirtualList</h3>
          <div ref={virtualRef}>
            <VirtualList
              items={manyPeople}
              label="Everyone, virtualized"
              itemKey={(person) => person.id}
              estimateItemHeight={53}
              className="h-72 rounded-lg border border-border"
              renderItem={(person) => <Person name={person.name} role={person.role} />}
            />
          </div>
          <p className="mt-2 text-xs text-fg-subtle">
            {counts.virtual} of 2000 rows in the document.
          </p>
        </div>
      </div>
    );
  },
};
