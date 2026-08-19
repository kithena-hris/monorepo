import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSX } from 'react';
import {
  Archive,
  CalendarPlus,
  Eraser,
  Lock,
  Mail,
  Pencil,
  Plus,
  Star,
  ThumbsDown,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '../avatar/avatar';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../dialog/dialog';
import { Field, FieldControl, FieldLabel } from '../field/field';
import { Input } from '../input/input';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Money } from '../money/money';
import {
  Kanban,
  type KanbanAction,
  type KanbanColumnDef,
  type KanbanHandlePosition,
  type KanbanMove,
} from './kanban';

interface Candidate {
  id: string;
  name: string;
  role: string;
  location: string;
  salaryMinor: string;
  days: number;
  flagged?: boolean;
}

const initialColumns: KanbanColumnDef[] = [
  { id: 'applied', title: 'Applied', description: 'Not yet screened', tone: 'neutral' },
  { id: 'screen', title: 'Phone screen', tone: 'info', limit: 4 },
  { id: 'onsite', title: 'Onsite', tone: 'accent', limit: 3 },
  { id: 'offer', title: 'Offer', tone: 'success' },
  {
    id: 'hired',
    title: 'Hired',
    description: 'Read only: set by the offer flow',
    tone: 'success',
    locked: true,
  },
];

const initialItems: Record<string, Candidate[]> = {
  applied: [
    {
      id: 'c1',
      name: 'Grace Hopper',
      role: 'Principal Engineer',
      location: 'Madrid',
      salaryMinor: '14200000',
      days: 2,
    },
    {
      id: 'c2',
      name: 'Ada Lovelace',
      role: 'Staff Engineer',
      location: 'Berlin',
      salaryMinor: '12850000',
      days: 5,
    },
    {
      id: 'c3',
      name: 'Joan Clarke',
      role: 'Payroll Specialist',
      location: 'Dublin',
      salaryMinor: '6400000',
      days: 9,
    },
  ],
  screen: [
    {
      id: 'c4',
      name: 'Radia Perlman',
      role: 'Engineering Manager',
      location: 'Dublin',
      salaryMinor: '13600000',
      days: 4,
    },
    {
      id: 'c5',
      name: 'Barbara Liskov',
      role: 'Distinguished Engineer',
      location: 'Madrid',
      salaryMinor: '15800000',
      days: 11,
      flagged: true,
    },
  ],
  onsite: [
    {
      id: 'c6',
      name: 'Katherine Johnson',
      role: 'Data Analyst',
      location: 'Lisbon',
      salaryMinor: '8900000',
      days: 3,
    },
  ],
  offer: [
    {
      id: 'c7',
      name: 'Margaret Hamilton',
      role: 'Head of People',
      location: 'Remote',
      salaryMinor: '16200000',
      days: 1,
    },
  ],
  hired: [
    {
      id: 'c8',
      name: 'Anita Borg',
      role: 'Staff Engineer',
      location: 'Berlin',
      salaryMinor: '12400000',
      days: 0,
    },
  ],
};

/** Pure, so the story is a reducer and not a pile of mutations. */
function applyMove(
  items: Record<string, Candidate[]>,
  { itemId, from, to, toIndex }: KanbanMove,
): Record<string, Candidate[]> {
  const source = [...(items[from] ?? [])];
  const index = source.findIndex((item) => item.id === itemId);
  if (index === -1) return items;
  const [moved] = source.splice(index, 1);
  if (!moved) return items;

  if (from === to) {
    const clamped = Math.max(0, Math.min(toIndex, source.length));
    source.splice(clamped, 0, moved);
    return { ...items, [from]: source };
  }

  const target = [...(items[to] ?? [])];
  target.splice(Math.max(0, Math.min(toIndex, target.length)), 0, moved);
  return { ...items, [from]: source, [to]: target };
}

/**
 * How a bulk action names what it acted on. Hoisted because it closes over
 * nothing: rebuilding it per render only churns the identity of a pure helper.
 */
const names = (cards: readonly Candidate[]): string =>
  cards.length === 1 ? (cards[0]?.name ?? '') : `${String(cards.length)} candidates`;

const meta = {
  title: 'Components/Kanban',
  component: Kanban,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          'A board of columns you can drag cards between, with a keyboard, a screen reader, a finger or a mouse.',
          '',
          '### Why `@dnd-kit` and not the native drag API',
          '',
          'The HTML drag-and-drop API does not fire on touch at all, its drag image is unstyleable, and it has no keyboard story. All three are disqualifying for a board that runs on an iPad. dnd-kit is pointer-event based, and ships a keyboard sensor plus the live-region plumbing that makes a drag audible, the part nobody hand-rolls correctly.',
          '',
          '### Drag is never the only way to move a card',
          '',
          'Every card carries a **Move to** menu listing the other columns, plus move up and down. That is not a legacy fallback: it is the primary path for a screen-reader user, a switch user, anyone with a tremor, and anyone on a train. A board whose only state transition is a sustained precise gesture excludes people, and the menu costs one dropdown.',
          '',
          'The keyboard drag works too. Tab to a card\'s grip, press **Space**, use the **arrow keys**, press **Space** to drop or **Escape** to cancel. Every step is announced: *"Picked up Grace Hopper from Applied, position 1"*, then *"moved to Phone screen, position 2"*.',
          '',
          '### The details',
          '',
          '- **The grip is draggable, not the card.** A draggable card cannot contain a working link or button, and it hijacks text selection, which people do constantly on a board of names.',
          '- **A 6px activation distance** on the pointer sensor, so a click is still a click.',
          '- **The original stays in place at 40% opacity** while a `DragOverlay` copy flies. The hole it leaves is where "back where it started" is.',
          '- **The whole column lights up** as a drop target. A 2px line between two cards is invisible on a moving board.',
          '- **The destination opens a gap**, in the column you are dragging *into*, not only the one you started in: see below.',
          '- **Columns scroll-snap** so a flick on a phone lands on a column, not between two.',
          '',
          '### The gap, and why it used to open in only one column',
          '',
          'A column shifts its cards apart because its `SortableContext` knows an item is being placed among them. When the board only committed on drop, the destination column never learned a card was coming, so nothing moved, and the drop landed with a jump. Reordering *within* a column appeared to work only because the card was already in that context.',
          '',
          'So the board now keeps a throwaway preview of itself for the duration of the gesture. Crossing a boundary moves the card in that preview, which puts it inside the destination context and opens the gap there. The preview is discarded on drop and on cancel; the props are the truth either side of the drag.',
          '',
          'Two supporting settings, both needed for it to land accurately: droppables are re-measured continuously (`MeasuringStrategy.Always`), because a column that grew or shrank keeps a stale rectangle otherwise; and `animateLayoutChanges` is forced on, because dnd-kit suppresses the layout animation by default for exactly the case this board animates.',
          '',
          '### Why it is smooth now',
          '',
          'Four separate causes of the jitter it used to have, all of them the same mistake, two authors writing one property:',
          '',
          '1. **A CSS keyframe on the drag overlay.** dnd-kit writes `transform` on that node every frame; a `animate-lift` class writing `transform` at the same time is a fight at 60fps. The tilt moved to an inner element dnd-kit never touches.',
          '2. **No `fill-mode` on that keyframe.** It snapped back to untilted the instant it finished, a visible flick at the start of every drag. It is `forwards` now.',
          '3. **`CSS.Translate` instead of `CSS.Transform`.** Translate alone drops the scale dnd-kit computes when a neighbour is a different height, so a card that should shrink jumped its full height in one frame.',
          "4. **A transition covering `transform`.** Transitioning a property that is rewritten 60 times a second reads as lag on pick-up and as a rubber band on drop. Only `box-shadow` and `opacity` transition now; the transform transition is dnd-kit's, and its duration comes from `motion`.",
          '',
          'Plus `will-change: transform` for the duration of a drag only: leaving it on every card of a 200-card board is how a browser runs out of compositor layers.',
          '',
          '### Scrolling',
          '',
          'Dragging to an edge scrolls: the board sideways, the column vertically. The threshold is 20% of the container, so it stays out of the way until the card is genuinely at the edge. The board and every column also scroll smoothly for the scrolls this component *causes*, the keyboard sensor bringing a card into view, while a finger flick is untouched, and `prefers-reduced-motion` turns it back to instant.',
          '',
          '### What starts a drag',
          '',
          'Three exclusive modes, so the prop is a discriminated union rather than a bag of optionals. `position` and `reveal` do not exist without a handle, and a type that lets you pass them anyway lets you write a call nobody can explain.',
          '',
          '| `dragActivator` | Behaviour |',
          '| --- | --- |',
          '| `{ mode: "handle", position, reveal }` | A dedicated grip. The default, and the safe one: the card can still hold links, buttons and selectable text. |',
          '| `{ mode: "card" }` | The whole card. Faster to hit, better on a phone, at the cost of text selection inside it. A hidden focusable activator is still rendered, so the keyboard drag survives. |',
          '| `{ mode: "none" }` | Nothing drags; the move menu is the only route. |',
          '',
          'Handle positions are the eight points of a nine-point box, named with CSS logical properties: `top-start`, `top-center`, `top-end`, `middle-start`, `middle-end`, `bottom-start`, `bottom-center`, `bottom-end`. `start`/`end` follow the writing direction, so a board in Arabic puts a `top-start` grip on the right with no second set of classes.',
          '',
          '### Scroll speed',
          '',
          'The default acceleration is **6**, not dnd-kit\'s 10. A board scrolls *sideways*, and the speed that feels right vertically overshoots two columns before the hand reacts. `speed: "slow"` (3) suits a wide board; `"fast"` (14) only a short one. `interval` stays at 5ms in every preset. That is step frequency, not speed, and raising it makes the scroll choppy rather than slower.',
          '',
          '### Actions',
          '',
          'Two layers, one type. `KanbanAction<T>` takes `run(items)`, a bulk action is not a different kind of thing from a single-card one, and giving it a second interface is how "Archive" ends up meaning two subtly different operations depending on where it was invoked from.',
          '',
          '- **`cardActions`** appear in the card menu and, identically, in its right-click menu.',
          '- **`columnActions`** appear in the column header menu and on right-click of that header, not of the whole column, because a card already owns the right-click inside the list and two context menus opening from one event is worse than either.',
          '- **`bulkActions`** appear in the selection bar once anything is ticked. The first three are buttons; the rest fall into an overflow menu, because a bar of nine buttons is a toolbar nobody reads.',
          '',
          'Every command routes through one place inside the board, so a `confirm` cannot be honoured in the card menu and forgotten in the bulk bar. Confirmation raises a single `AlertDialog` mounted once for the whole board: forty cards each holding their own is forty portals and forty focus scopes for something at most one of them will show.',
          '',
          'The confirmation copy takes the items, so the count lands in the sentence: *"Reject 4 candidates?"* rather than *"Are you sure?"*. A bulk action on forty records is forty mistakes at once.',
          '',
          'Prefer `disabled` to `hidden`. A command that vanishes teaches nobody what the product can do; one that is greyed out with a reason beside it does.',
          '',
          '### Selection',
          '',
          'Per-card checkboxes, plus a select-all in each column header that reports `aria-checked="mixed"` when the column is partly selected, the difference between "some of these" and "none of these". The count in the bar is a live region, because a selection that changes silently is one a screen-reader user cannot audit before running something on it.',
          '',
          'Selected cards take a `ring`, never a border swap: a border change moves the content by a pixel, and a column flickering by a pixel as the selection changes is worse than no indication.',
          '',
          '### Controlled, committed once',
          '',
          'The board holds no copy of your data outside a drag. `onMove` fires once, on drop, with the destination column and index, so the optimistic update and its rollback stay with the caller, which is the only place that knows whether the server accepted the transition.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    columns: {
      description:
        'Column definitions. `limit` shows a WIP limit (shown, never enforced: enforcement is a domain rule), `locked` blocks drops and hides the column from the move menu.',
      control: 'object',
      table: { type: { summary: 'readonly KanbanColumnDef[]' }, category: 'Data' },
    },
    items: {
      description: 'Items keyed by column id. Array order is board order.',
      control: 'object',
      table: { type: { summary: 'Record<string, readonly T[]>' }, category: 'Data' },
    },
    renderCard: {
      description:
        'Renders a card body. Receives `{ columnId, dragging }` so the drag overlay can render differently from the card in place.',
      control: false,
      table: { type: { summary: '(item, context) => ReactNode' }, category: 'Data' },
    },
    onMove: {
      description:
        'Fires once on drop, and from the move menu. `toIndex` is the insertion index **after** the item has been removed from its source column.',
      control: false,
      table: { type: { summary: '(move: KanbanMove) => void' }, category: 'Data' },
    },
    label: {
      description: 'Names the board region. Required.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
    describeItem: {
      description:
        'Turns an item into the string used in every drag announcement and in the move menu. Without it a screen reader hears the id.',
      control: false,
      table: { type: { summary: '(item: T) => string' }, category: 'Accessibility' },
    },
    renderColumnFooter: {
      description: 'Rendered under a column\'s cards. An "Add card" control, usually.',
      control: false,
      table: { type: { summary: '(column) => ReactNode' }, category: 'Content' },
    },
    columnWidth: {
      description: 'Fixed column width. The board scrolls horizontally past the viewport.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: '19rem' },
        category: 'Appearance',
      },
    },
    dragActivator: {
      description:
        'What starts a drag. A discriminated union: `{ mode: "handle", position?, reveal? }`, `{ mode: "card" }` or `{ mode: "none" }`. `position` and `reveal` only exist on the handle variant, because they are meaningless without one.',
      control: 'object',
      table: {
        type: {
          summary:
            "{ mode: 'handle'; position?: KanbanHandlePosition; reveal?: 'hover' | 'always' } | { mode: 'card' } | { mode: 'none' }",
        },
        defaultValue: { summary: "{ mode: 'handle' }" },
        category: 'Interaction',
      },
    },
    autoScroll: {
      description:
        'Edge scrolling while dragging. `{ mode: "auto", speed?, edgeSize? }`, `{ mode: "custom", acceleration, threshold, interval? }` or `{ mode: "off" }`.',
      control: 'object',
      table: {
        type: {
          summary:
            "{ mode: 'auto'; speed?: 'slow' | 'normal' | 'fast'; edgeSize?: number } | { mode: 'custom'; … } | { mode: 'off' }",
        },
        defaultValue: { summary: "{ mode: 'auto' }: acceleration 6" },
        category: 'Interaction',
      },
    },
    cardActions: {
      description:
        'Commands for a single card. Rendered in the card menu **and** in its right-click menu, the same list in both, because a command that exists only on right-click does not exist.',
      control: false,
      table: { type: { summary: 'readonly KanbanAction<T>[]' }, category: 'Actions' },
    },
    bulkActions: {
      description:
        'Commands for the current selection. Needs `selection.mode: "multiple"`; without it there is nothing to act on and the bar never appears. The first three render as buttons, the rest fall into a menu.',
      control: false,
      table: { type: { summary: 'readonly KanbanAction<T>[]' }, category: 'Actions' },
    },
    columnActions: {
      description:
        'Commands for a column: rename, clear, delete. Typed as `KanbanAction<KanbanColumnDef>` rather than a fourth interface: a column has an `id`, `run` still takes the thing being acted on, and the confirmation plumbing is shared. They appear in the column header menu and on right-click **of the header**, not of the whole column.',
      control: false,
      table: { type: { summary: 'readonly KanbanAction<KanbanColumnDef>[]' }, category: 'Actions' },
    },
    selection: {
      description:
        'Card selection. `{ mode: "multiple", selected, onSelectionChange }` or `{ mode: "none" }`: another discriminated union, because a controlled selection with no handler is a checkbox that cannot be unticked.',
      control: false,
      table: {
        type: {
          summary:
            "{ mode: 'none' } | { mode: 'multiple'; selected: readonly string[]; onSelectionChange: (ids) => void }",
        },
        defaultValue: { summary: "{ mode: 'none' }" },
        category: 'Actions',
      },
    },
    motion: {
      description:
        'Duration and easing of every card movement, including the drop. `{ preset: "snappy" | "smooth" | "calm" }`, `{ preset: "custom", duration, easing }` or `{ preset: "none" }`.',
      control: 'object',
      table: {
        type: {
          summary:
            "{ preset: 'snappy' | 'smooth' | 'calm' } | { preset: 'custom'; duration: number; easing: string } | { preset: 'none' }",
        },
        defaultValue: { summary: "{ preset: 'smooth' }. 300ms easeOutQuint" },
        category: 'Appearance',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    columns: initialColumns,
    items: initialItems,
    label: 'Hiring pipeline',
    columnWidth: '19rem',
    dragActivator: { mode: 'handle', position: 'middle-start', reveal: 'hover' },
    autoScroll: { mode: 'auto', speed: 'normal' },
    motion: { preset: 'smooth' },
    renderCard: () => null,
    onMove: () => undefined,
  },
} satisfies Meta<typeof Kanban<Candidate>>;

export default meta;
type Story = StoryObj<typeof meta>;

function CandidateCard({ candidate }: { candidate: Candidate }): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <Avatar size="sm" name={candidate.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-fg">{candidate.name}</p>
          <p className="truncate text-xs text-fg-muted">{candidate.role}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge size="sm">{candidate.location}</Badge>
        {candidate.flagged ? (
          <Badge size="sm" tone="warning" dot>
            Stalled {candidate.days}d
          </Badge>
        ) : (
          <span className="text-xs text-fg-subtle">{candidate.days}d in stage</span>
        )}
      </div>
      <p className="text-xs tabular-nums text-fg-muted">
        Target <Money minorUnits={candidate.salaryMinor} currency="EUR" locale="en-IE" />
      </p>
    </div>
  );
}

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [items, setItems] = useState(initialItems);
    const [lastMove, setLastMove] = useState<string | null>(null);

    return (
      <div className="min-h-screen space-y-3 bg-canvas p-4">
        <p aria-live="polite" className="text-sm text-fg-muted">
          {lastMove ?? 'Drag a card, or use its grip with the keyboard, or its move menu.'}
        </p>
        <Kanban<Candidate>
          {...args}
          items={items}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
            const name = Object.values(items)
              .flat()
              .find((candidate) => candidate.id === move.itemId)?.name;
            const to = args.columns.find((column) => column.id === move.to)?.title;
            setLastMove(
              `${name ?? move.itemId} → ${to ?? move.to}, position ${String(move.toIndex + 1)}`,
            );
          }}
          renderColumnFooter={(column) =>
            column.locked ? null : (
              <Button
                size="sm"
                variant="ghost"
                startIcon={<Plus />}
                fullWidth
                className="justify-start"
              >
                Add candidate
              </Button>
            )
          }
        />
      </div>
    );
  },
};

export const KeyboardOnly: Story = {
  name: 'Without a mouse',
  parameters: {
    docs: {
      description: {
        story: [
          'Put the mouse down and try both paths.',
          '',
          "**The drag.** Tab until a card's grip has focus, press Space, arrow around, press Space to drop. The board announces every step through a live region.",
          '',
          '**The menu.** Tab to the ⇥ button on a card, open it, pick a column. Same result, no sustained gesture, no spatial reasoning. For most screen-reader users this is the faster path, which is exactly why it is not hidden behind a preference.',
          '',
          'Note that the locked column never appears in the menu and refuses drops, a column whose contents are owned by another workflow should not be writable by hand.',
        ].join('\n'),
      },
    },
  },
  render: function KeyboardStory(args) {
    const [items, setItems] = useState(initialItems);
    return (
      // A bounded height, because that is the only shape in which a column
      // scrolls. On an unbounded board every column grows to fit its cards, so
      // there is nothing to scroll and nothing to virtualize.
      <div className="h-[42rem] bg-canvas p-4">
        <Kanban<Candidate>
          {...args}
          className="h-full"
          items={items}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};

export const WipLimits: Story = {
  name: 'Limits and locked columns',
  parameters: {
    docs: {
      description: {
        story:
          'Phone screen is limited to 4 and Onsite to 3. Move a fifth card into Phone screen: the badge turns red and a status line appears, but the move is **allowed**. A WIP limit is a signal to a team, not a domain invariant, and a board that silently refuses a drop teaches people that the board is broken.',
      },
    },
  },
  render: function LimitStory(args) {
    const [items, setItems] = useState<Record<string, Candidate[]>>({
      ...initialItems,
      screen: [
        ...(initialItems['screen'] ?? []),
        {
          id: 'c9',
          name: 'Karen Spärck Jones',
          role: 'Recruiter',
          location: 'Madrid',
          salaryMinor: '5800000',
          days: 6,
        },
        {
          id: 'c10',
          name: 'Frances Allen',
          role: 'Staff Engineer',
          location: 'Dublin',
          salaryMinor: '12100000',
          days: 8,
        },
        {
          id: 'c11',
          name: 'Alan Turing',
          role: 'Data Analyst',
          location: 'Remote',
          salaryMinor: '9100000',
          days: 14,
          flagged: true,
        },
      ],
    });

    return (
      // A bounded height, because that is the only shape in which a column
      // scrolls. On an unbounded board every column grows to fit its cards, so
      // there is nothing to scroll and nothing to virtualize.
      <div className="h-[42rem] bg-canvas p-4">
        <Kanban<Candidate>
          {...args}
          className="h-full"
          items={items}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};

export const CrossColumn: Story = {
  name: 'The gap opens in both columns',
  parameters: {
    docs: {
      description: {
        story: [
          'Drag a card from **Applied** into the middle of **Onsite** and hold it there. Two things happen that did not before: the cards below the pointer slide down to open a slot, and the source column closes up behind you.',
          '',
          "Both come from the same mechanism, the in-drag preview moves the card into the destination column, so that column's sortable context has something to make room for. Without it the destination is inert until the moment of release.",
          '',
          'The tall columns here are deliberate: drag towards the bottom of one and it scrolls; drag past the right-hand edge and the board scrolls.',
        ].join('\n'),
      },
    },
  },
  render: function CrossColumnStory(args) {
    const [items, setItems] = useState<Record<string, Candidate[]>>(() => ({
      ...initialItems,
      onsite: [
        ...(initialItems['onsite'] ?? []),
        {
          id: 'x1',
          name: 'Karen Spärck Jones',
          role: 'Recruiter',
          location: 'Madrid',
          salaryMinor: '5800000',
          days: 6,
        },
        {
          id: 'x2',
          name: 'Frances Allen',
          role: 'Staff Engineer',
          location: 'Dublin',
          salaryMinor: '12100000',
          days: 8,
        },
        {
          id: 'x3',
          name: 'Alan Turing',
          role: 'Data Analyst',
          location: 'Remote',
          salaryMinor: '9100000',
          days: 14,
        },
      ],
    }));

    return (
      <div className="h-[36rem] bg-canvas p-4">
        <Kanban<Candidate>
          {...args}
          className="h-full"
          items={items}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};

export const OnAPhone: Story = {
  name: 'On a phone',
  parameters: {
    docs: {
      description: {
        story:
          'Switch the viewport to an iPhone. Columns scroll-snap so a flick lands on a column rather than between two, the grip and move button are permanently visible (there is no hover to reveal them with), and both are on the 44px floor. Dragging across a column boundary on a 375px screen is genuinely hard, which is the strongest argument for the move menu being a first-class path rather than an afterthought.',
      },
    },
  },
  render: function PhoneStory(args) {
    const [items, setItems] = useState(initialItems);
    return (
      <div className="min-h-screen bg-canvas p-3">
        <Kanban<Candidate>
          {...args}
          columnWidth="17rem"
          items={items}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};

export const HandlePositions: Story = {
  name: 'Handle positions',
  parameters: {
    docs: {
      description: {
        story: [
          'The eight positions, each on a live board. Hover a card to reveal its grip.',
          '',
          'Which to pick is a content question, not a taste one. `middle-start` is the list convention and the one people reach for without being told. `top-end` keeps the first line of a card flush left, which matters when that line is a name being scanned down a column. `bottom-center` is for a card whose top edge is an image.',
          '',
          '`start` and `end` are logical, so a right-to-left board mirrors them without a second set of classes.',
        ].join('\n'),
      },
    },
  },
  render: function PositionStory(args) {
    const positions: KanbanHandlePosition[] = [
      'top-start',
      'top-center',
      'top-end',
      'middle-start',
      'middle-end',
      'bottom-start',
      'bottom-center',
      'bottom-end',
    ];
    const [position, setPosition] = useState<KanbanHandlePosition>('middle-start');
    const [reveal, setReveal] = useState<'hover' | 'always'>('hover');
    const [items, setItems] = useState(initialItems);

    return (
      <div className="min-h-screen space-y-4 bg-canvas p-4">
        <div className="flex flex-wrap items-center gap-2">
          {positions.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === position ? 'subtle' : 'secondary'}
              aria-pressed={option === position}
              onClick={() => {
                setPosition(option);
              }}
            >
              {option}
            </Button>
          ))}
          <Button
            size="sm"
            variant={reveal === 'always' ? 'subtle' : 'secondary'}
            aria-pressed={reveal === 'always'}
            onClick={() => {
              setReveal((current) => (current === 'always' ? 'hover' : 'always'));
            }}
          >
            reveal: {reveal}
          </Button>
        </div>

        <Kanban<Candidate>
          {...args}
          dragActivator={{ mode: 'handle', position, reveal }}
          items={items}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};

export const WholeCardDraggable: Story = {
  name: 'The whole card drags',
  args: { dragActivator: { mode: 'card' } },
  parameters: {
    docs: {
      description: {
        story: [
          'No grip: pointer events are on the card itself. Faster to hit, and the right default on a phone where a 24px handle is a poor target.',
          '',
          'The costs are real and worth stating. Text inside the card can no longer be selected by dragging across it. Any button inside it, the move menu here: needs its own guard, which is why the 6px activation distance matters more in this mode than in any other.',
          '',
          'The keyboard drag still works: a visually hidden activator is rendered and appears on focus, because a mode where only a pointer can start a drag is a mode that excludes people. Tab to a card and press Space.',
        ].join('\n'),
      },
    },
  },
  render: function CardModeStory(args) {
    const [items, setItems] = useState(initialItems);
    return (
      // A bounded height, because that is the only shape in which a column
      // scrolls. On an unbounded board every column grows to fit its cards, so
      // there is nothing to scroll and nothing to virtualize.
      <div className="h-[42rem] bg-canvas p-4">
        <Kanban<Candidate>
          {...args}
          className="h-full"
          items={items}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};

export const ScrollSpeed: Story = {
  name: 'Scroll speed and motion',
  parameters: {
    docs: {
      description: {
        story: [
          'A board twelve columns wide, so the horizontal scroll is worth measuring. Drag a card to the right-hand edge and hold it there on each speed in turn.',
          '',
          '`slow` (acceleration 3) is what a wide board wants: the columns pass at a rate the hand can still aim at. `normal` (6) is the default. `fast` (14) was the old behaviour, and on this board it overshoots two columns before the eye catches up.',
          '',
          '`edgeSize` is separate from speed. It is how close to the edge scrolling starts, as a fraction of the container. Raise it on a board with wide columns, where the pointer reaches the edge later than it looks like it should.',
          '',
          'The motion preset changes every card movement including the drop: `snappy` 180ms, `smooth` 300ms easeOutQuint (default), `calm` 450ms easeOutExpo.',
          '',
          'The curve matters more than the number. On easeOutQuint nearly all of the distance is covered in the first third and the rest is a settle, which is why 300ms here feels *faster* than 200ms on a linear curve, the eye tracks the arrival, not the duration.',
        ].join('\n'),
      },
    },
  },
  render: function SpeedStory(args) {
    const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
    const [edgeSize, setEdgeSize] = useState(0.2);
    const [preset, setPreset] = useState<'snappy' | 'smooth' | 'calm'>('smooth');

    const wideColumns: KanbanColumnDef[] = Array.from({ length: 12 }, (_, index) => ({
      id: `stage-${String(index)}`,
      title: `Stage ${String(index + 1)}`,
      tone: index === 0 ? 'neutral' : index === 11 ? 'success' : 'info',
    }));

    const [items, setItems] = useState<Record<string, Candidate[]>>(() =>
      Object.fromEntries(
        wideColumns.map((column, index) => [
          column.id,
          index % 3 === 0
            ? [
                {
                  id: `w${String(index)}`,
                  name: `Candidate ${String(index + 1)}`,
                  role: 'Staff Engineer',
                  location: 'Madrid',
                  salaryMinor: '12100000',
                  days: index,
                },
              ]
            : [],
        ]),
      ),
    );

    return (
      <div className="min-h-screen space-y-4 bg-canvas p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-fg-muted">Speed</span>
            {(['slow', 'normal', 'fast'] as const).map((option) => (
              <Button
                key={option}
                size="sm"
                variant={option === speed ? 'subtle' : 'secondary'}
                aria-pressed={option === speed}
                onClick={() => {
                  setSpeed(option);
                }}
              >
                {option}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="edge-size" className="text-sm text-fg-muted">
              Edge size
            </label>
            <input
              id="edge-size"
              type="range"
              min={0.05}
              max={0.45}
              step={0.05}
              value={edgeSize}
              onChange={(event) => {
                setEdgeSize(Number(event.target.value));
              }}
            />
            <span className="w-10 text-sm tabular-nums text-fg">{edgeSize.toFixed(2)}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-fg-muted">Motion</span>
            {(['snappy', 'smooth', 'calm'] as const).map((option) => (
              <Button
                key={option}
                size="sm"
                variant={option === preset ? 'subtle' : 'secondary'}
                aria-pressed={option === preset}
                onClick={() => {
                  setPreset(option);
                }}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>

        <Kanban<Candidate>
          {...args}
          label="Twelve-stage pipeline"
          columns={wideColumns}
          items={items}
          columnWidth="15rem"
          autoScroll={{ mode: 'auto', speed, edgeSize }}
          motion={{ preset }}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};

export const NoDragging: Story = {
  name: 'Menu only',
  args: { dragActivator: { mode: 'none' }, autoScroll: { mode: 'off' } },
  parameters: {
    docs: {
      description: {
        story:
          'No grip, no card drag, no edge scrolling, the move menu is the only route. This is what a board looks like on a locked-down kiosk, and it is also a useful reminder of what a screen-reader user has always been using: the same menu, doing the same thing, with none of the machinery above it.',
      },
    },
  },
  render: function MenuOnlyStory(args) {
    const [items, setItems] = useState(initialItems);
    return (
      // A bounded height, because that is the only shape in which a column
      // scrolls. On an unbounded board every column grows to fit its cards, so
      // there is nothing to scroll and nothing to virtualize.
      <div className="h-[42rem] bg-canvas p-4">
        <Kanban<Candidate>
          {...args}
          className="h-full"
          items={items}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};

export const Actions: Story = {
  name: 'Card and bulk actions',
  parameters: {
    docs: {
      description: {
        story: [
          'Both layers, working, built out of the rest of the system. `Checkbox` for selection, `Button` and `Badge` for the bar, `DropdownMenu` for the card menu and the bar overflow, `ContextMenu` for right-click, `AlertDialog` for the confirmation, `Separator` for the divider.',
          '',
          'Tick a card, or a whole column from its header checkbox. The bar names the count, offers the first three commands as buttons and the rest in a menu, and can extend the selection to the whole board.',
          '',
          '**Reject** is destructive and confirms: note the sentence: *"Reject 4 candidates?"*, not *"Are you sure?"*. The count is what makes a bulk action reviewable. **Advance** is disabled once anything in the selection is already at the final stage, which is a rule the board cannot know and the caller can.',
          '',
          'Right-click any card for the same single-card commands. The card menu carries them too, because right-click is an accelerator and never the only route.',
        ].join('\n'),
      },
    },
  },
  render: function ActionsStory(args) {
    const [items, setItems] = useState(initialItems);
    const [selected, setSelected] = useState<readonly string[]>([]);
    const [log, setLog] = useState<string | null>(null);
    const [starred, setStarred] = useState<readonly string[]>([]);

    const columnOf = (id: string): string =>
      Object.entries(items).find(([, list]) => list.some((card) => card.id === id))?.[0] ??
      'applied';

    const advance = (cards: readonly Candidate[]): void => {
      const order = initialColumns.map((column) => column.id);
      setItems((current) =>
        cards.reduce((board, card) => {
          const from = Object.entries(board).find(([, list]) =>
            list.some((entry) => entry.id === card.id),
          )?.[0];
          if (!from) return board;
          const next = order[Math.min(order.indexOf(from) + 1, order.length - 2)];
          if (!next || next === from) return board;
          return applyMove(board, { itemId: card.id, from, to: next, toIndex: 0 });
        }, current),
      );
      setSelected([]);
    };

    const shared: KanbanAction<Candidate>[] = [
      {
        id: 'advance',
        label: 'Advance a stage',
        icon: <UserCheck />,
        shortcut: '⌘⏎',
        // The board cannot know that "Offer" has nowhere to advance to. The
        // caller can, so the rule lives here rather than in the component.
        disabled: (cards) => cards.some((card) => columnOf(card.id) === 'offer'),
        run: (cards) => {
          advance(cards);
          setLog(`Advanced ${names(cards)}.`);
        },
      },
      {
        id: 'star',
        label: 'Star',
        icon: <Star />,
        run: (cards) => {
          setStarred((current) => [...new Set([...current, ...cards.map((card) => card.id)])]);
          setLog(`Starred ${names(cards)}.`);
        },
      },
      {
        id: 'schedule',
        label: 'Schedule an interview',
        icon: <CalendarPlus />,
        run: (cards) => {
          setLog(`Interview scheduling opened for ${names(cards)}.`);
        },
      },
      {
        id: 'email',
        label: 'Send an update',
        icon: <Mail />,
        run: (cards) => {
          setLog(`Update drafted for ${names(cards)}.`);
        },
      },
      {
        id: 'archive',
        label: 'Archive',
        icon: <Archive />,
        run: (cards) => {
          setLog(`Archived ${names(cards)}.`);
        },
      },
      {
        id: 'reject',
        label: 'Reject',
        icon: <ThumbsDown />,
        destructive: true,
        confirm: {
          title: (cards) => `Reject ${names(cards)}?`,
          description: (cards) =>
            cards.length === 1
              ? `${cards[0]?.name ?? 'This candidate'} is emailed immediately. A rejection cannot be withdrawn from here.`
              : `All ${String(cards.length)} are emailed immediately. Rejections cannot be withdrawn from here.`,
          confirmLabel: 'Reject and notify',
        },
        run: (cards) => {
          setItems((current) =>
            Object.fromEntries(
              Object.entries(current).map(([columnId, list]) => [
                columnId,
                list.filter((card) => !cards.some((rejected) => rejected.id === card.id)),
              ]),
            ),
          );
          setSelected([]);
          setLog(`Rejected ${names(cards)}.`);
        },
      },
    ];

    return (
      <div className="min-h-screen space-y-3 bg-canvas p-4">
        <p aria-live="polite" className="min-h-5 text-sm text-fg-muted">
          {log ?? 'Tick a card, or right-click one.'}
        </p>

        <Kanban<Candidate>
          {...args}
          items={items}
          selection={{ mode: 'multiple', selected, onSelectionChange: setSelected }}
          cardActions={shared}
          bulkActions={shared}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => (
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Avatar size="sm" name={candidate.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-fg">{candidate.name}</p>
                  <p className="truncate text-xs text-fg-muted">{candidate.role}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge size="sm">{candidate.location}</Badge>
                {starred.includes(candidate.id) ? (
                  <Badge size="sm" tone="warning" dot>
                    Starred
                  </Badge>
                ) : null}
              </div>
            </div>
          )}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};

export const Sections: Story = {
  name: 'Adding and deleting sections',
  parameters: {
    docs: {
      description: {
        story: [
          'Columns are data, so a board that can add and remove them needs nothing from this component beyond `columnActions`.',
          '',
          '**Add a section** appends a column and scrolls it into view. **Rename** opens a dialog rather than a `prompt()`, a native prompt blocks the thread, cannot be styled, and on iOS lands somewhere the keyboard covers.',
          '',
          '**Delete** confirms, and the confirmation says what will happen to the cards: *"Onsite holds 3 cards. They will move to Applied."* A dialog that only asks "are you sure?" makes the user guess at exactly the moment they most need to be told. Deleting the last section is disabled rather than hidden, a board with no columns is not a state worth supporting, and a greyed command with a reason teaches more than a missing one.',
          '',
          '**Lock** flips `locked`, which blocks drops and removes the column from every move menu: useful for a stage another workflow owns.',
          '',
          'Right-click any column header for the same commands. The ⋯ button carries them too, because right-click is the accelerator and never the only route.',
        ].join('\n'),
      },
    },
  },
  render: function SectionsStory(args) {
    const [columns, setColumns] = useState<KanbanColumnDef[]>(initialColumns);
    const [items, setItems] = useState<Record<string, Candidate[]>>(initialItems);
    const [renaming, setRenaming] = useState<KanbanColumnDef | null>(null);
    const [draftTitle, setDraftTitle] = useState('');
    const [nextId, setNextId] = useState(1);
    const [log, setLog] = useState<string | null>(null);

    const addSection = (): void => {
      const id = `stage-${String(nextId)}`;
      setColumns((current) => [
        ...current,
        { id, title: `New section ${String(nextId)}`, tone: 'neutral' },
      ]);
      setItems((current) => ({ ...current, [id]: [] }));
      setNextId((current) => current + 1);
      setLog(`Added a section.`);
    };

    const columnActions: KanbanAction<KanbanColumnDef>[] = [
      {
        id: 'rename',
        label: 'Rename',
        icon: <Pencil />,
        run: ([target]) => {
          if (!target) return;
          setRenaming(target);
          setDraftTitle(target.title);
        },
      },
      {
        id: 'add-card',
        label: 'Add a card',
        icon: <Plus />,
        disabled: ([target]) => target?.locked ?? false,
        run: ([target]) => {
          if (!target) return;
          const id = `card-${String(Date.now())}`;
          setItems((current) => ({
            ...current,
            [target.id]: [
              {
                id,
                name: 'New candidate',
                role: 'To be filled in',
                location: 'Remote',
                salaryMinor: '0',
                days: 0,
              },
              ...(current[target.id] ?? []),
            ],
          }));
          setLog(`Added a card to ${target.title}.`);
        },
      },
      {
        id: 'lock',
        label: 'Lock or unlock',
        icon: <Lock />,
        run: ([target]) => {
          if (!target) return;
          setColumns((current) =>
            current.map((column) =>
              column.id === target.id ? { ...column, locked: !(column.locked ?? false) } : column,
            ),
          );
          setLog(`${(target.locked ?? false) ? 'Unlocked' : 'Locked'} ${target.title}.`);
        },
      },
      {
        id: 'clear',
        label: 'Clear the section',
        icon: <Eraser />,
        disabled: ([target]) => (items[target?.id ?? '']?.length ?? 0) === 0,
        confirm: {
          title: ([target]) => `Clear ${target?.title ?? 'this section'}?`,
          description: ([target]) =>
            `${String(items[target?.id ?? '']?.length ?? 0)} cards are removed from the board. The section itself stays.`,
          confirmLabel: 'Clear it',
        },
        run: ([target]) => {
          if (!target) return;
          setItems((current) => ({ ...current, [target.id]: [] }));
          setLog(`Cleared ${target.title}.`);
        },
      },
      {
        id: 'delete',
        label: 'Delete the section',
        icon: <Trash2 />,
        destructive: true,
        // Disabled rather than hidden. A board with no columns is not a state
        // worth supporting, and a greyed command with a reason beside it
        // teaches more than a command that quietly disappears.
        disabled: () => columns.length <= 1,
        confirm: {
          title: ([target]) => `Delete ${target?.title ?? 'this section'}?`,
          description: ([target]) => {
            const count = items[target?.id ?? '']?.length ?? 0;
            const fallback =
              columns.find((column) => column.id !== target?.id)?.title ?? 'the first section';
            return count === 0
              ? 'The section is empty, so nothing else changes.'
              : `${target?.title ?? 'It'} holds ${String(count)} ${count === 1 ? 'card' : 'cards'}. They will move to ${fallback}.`;
          },
          confirmLabel: 'Delete the section',
        },
        run: ([target]) => {
          if (!target) return;
          const fallback = columns.find((column) => column.id !== target.id);
          setItems((current) => {
            const orphans = current[target.id] ?? [];
            // Rebuilt without the key rather than `delete`d: the same reason
            // the rest of this repo avoids it, and it keeps the object shape
            // monomorphic for the engine.
            const next = Object.fromEntries(
              Object.entries(current).filter(([columnId]) => columnId !== target.id),
            );
            // Cards are never destroyed by removing their column. Deleting a
            // stage is an organisational change; the people in it did not stop
            // existing.
            if (fallback) next[fallback.id] = [...(next[fallback.id] ?? []), ...orphans];
            return next;
          });
          setColumns((current) => current.filter((column) => column.id !== target.id));
          setLog(`Deleted ${target.title}.`);
        },
      },
    ];

    return (
      <div className="min-h-screen space-y-3 bg-canvas p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" startIcon={<Plus />} onClick={addSection}>
            Add a section
          </Button>
          <p aria-live="polite" className="text-sm text-fg-muted">
            {log ?? `${String(columns.length)} sections. Right-click a header, or use its ⋯ menu.`}
          </p>
        </div>

        <Kanban<Candidate>
          {...args}
          columns={columns}
          items={items}
          columnActions={columnActions}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />

        <Dialog
          open={renaming !== null}
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename the section</DialogTitle>
              <DialogDescription>Visible to everyone with access to this board.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field>
                <FieldLabel>Section name</FieldLabel>
                <FieldControl>
                  <Input
                    value={draftTitle}
                    onChange={(event) => {
                      setDraftTitle(event.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button
                  variant="primary"
                  disabled={draftTitle.trim().length === 0}
                  onClick={() => {
                    if (!renaming) return;
                    setColumns((current) =>
                      current.map((column) =>
                        column.id === renaming.id
                          ? { ...column, title: draftTitle.trim() }
                          : column,
                      ),
                    );
                    setLog(`Renamed to ${draftTitle.trim()}.`);
                  }}
                >
                  Rename
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  },
};

/**
 * A column long enough to virtualize, next to columns that are not.
 *
 * Past 80 cards a column mounts only the window around the scroll position,
 * with two spacer elements carrying the height of what is above and below.
 * Shorter columns are untouched, so a board where one lane has run away does
 * not change how the rest behave.
 *
 * The trade is real and worth stating: dnd-kit resolves a drop against mounted
 * nodes, so a card that has scrolled out of the DOM is not a drop target.
 * Auto-scroll mounts cards as the pointer reaches the edge, which keeps a drag
 * to anywhere reachable working; a drop onto a position hundreds of cards away
 * without scrolling there is not. Below the threshold nothing is unmounted and
 * the question does not arise, which is why the threshold sits where dragging
 * by hand has already stopped being practical.
 */
export const LongColumn: Story = {
  name: 'A very long column',
  parameters: {
    docs: {
      description: {
        story:
          'The Applied column holds 400 candidates. Scroll it and watch the other columns stay exactly as they were: virtualization is decided per column, not per board.',
      },
    },
  },
  render: function LongColumnStory(args) {
    const [items, setItems] = useState<Record<string, Candidate[]>>(() => ({
      ...initialItems,
      applied: Array.from({ length: 400 }, (_, index) => ({
        id: `long-${String(index)}`,
        name: `Candidate ${String(index + 1)}`,
        role: ['Engineer', 'Designer', 'Analyst'][index % 3] ?? 'Engineer',
        location: ['Berlin', 'Lisbon', 'Remote'][index % 3] ?? 'Remote',
        salaryMinor: String(5_500_000 + index * 250),
        days: index % 30,
      })),
    }));

    return (
      // A bounded height, because that is the only shape in which a column
      // scrolls. On an unbounded board every column grows to fit its cards, so
      // there is nothing to scroll and nothing to virtualize.
      <div className="h-[42rem] bg-canvas p-4">
        <Kanban<Candidate>
          {...args}
          className="h-full"
          items={items}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};

/**
 * Every column long, rather than one.
 *
 * Each column decides for itself, so a board of five long lanes runs five
 * independent windows. The thing to check here is that dragging still works
 * across them: pick a card up in one column and carry it to another, and the
 * destination mounts the cards around the pointer as it auto-scrolls.
 */
export const ManyLongColumns: Story = {
  name: 'Every column long',
  parameters: {
    docs: {
      description: {
        story:
          'Five columns of 150 cards each. Virtualization is per column, so nothing here is coordinated: each lane mounts the window around its own scroll position.',
      },
    },
  },
  render: function ManyLongColumnsStory(args) {
    const [items, setItems] = useState<Record<string, Candidate[]>>(() =>
      Object.fromEntries(
        initialColumns.map((column, columnIndex) => [
          column.id,
          Array.from({ length: 150 }, (_, index) => ({
            id: `${column.id}-${String(index)}`,
            name: `${column.title} ${String(index + 1)}`,
            role: ['Engineer', 'Designer', 'Analyst'][index % 3] ?? 'Engineer',
            location: ['Berlin', 'Lisbon', 'Remote'][columnIndex % 3] ?? 'Remote',
            salaryMinor: String(5_000_000 + index * 400),
            days: index % 21,
          })),
        ]),
      ),
    );

    return (
      <div className="h-[42rem] bg-canvas p-4">
        <Kanban<Candidate>
          {...args}
          className="h-full"
          items={items}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};

/**
 * Just under the threshold, so nothing is unmounted.
 *
 * Seventy-nine cards in the first column: one short of the point where a column
 * starts windowing. Everything is in the document, every card is a drop target
 * from the first frame, and a drag to the very bottom needs no scrolling to
 * become valid. It is here as the control case for the story above it.
 */
export const JustBelowTheThreshold: Story = {
  name: 'Just below the threshold',
  render: function BelowThresholdStory(args) {
    const [items, setItems] = useState<Record<string, Candidate[]>>(() => ({
      ...initialItems,
      applied: Array.from({ length: 79 }, (_, index) => ({
        id: `near-${String(index)}`,
        name: `Candidate ${String(index + 1)}`,
        role: ['Engineer', 'Designer', 'Analyst'][index % 3] ?? 'Engineer',
        location: 'Remote',
        salaryMinor: String(5_100_000 + index * 300),
        days: index % 14,
      })),
    }));

    return (
      <div className="h-[42rem] bg-canvas p-4">
        <Kanban<Candidate>
          {...args}
          className="h-full"
          items={items}
          describeItem={(candidate) => candidate.name}
          renderCard={(candidate) => <CandidateCard candidate={candidate} />}
          onMove={(move) => {
            setItems((current) => applyMove(current, move));
          }}
        />
      </div>
    );
  },
};
