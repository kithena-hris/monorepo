import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type JSX } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../alert-dialog/alert-dialog';
import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Field, FieldLabel } from '../field/field';
import { Input } from '../input/input';
import { Kbd } from '../kbd/kbd';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet';

const meta = {
  title: 'Components/Sheet',
  component: SheetContent,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'An edge-anchored panel: detail without losing the list behind it.',
          '',
          '### Why this is the workhorse of an HRIS',
          '',
          "A leave request opened from a queue of forty belongs in a sheet, because the reviewer's context *is* the queue. A route change loses their scroll position, their filters and their place; a centred modal covers the very row they were comparing against. The sheet keeps both.",
          '',
          'It is still modal: focus is trapped and Escape closes, so it is the wrong choice for anything the user needs to reference while working elsewhere. That is a split pane, not an overlay.',
          '',
          '### Sheet, dialog or alert dialog',
          '',
          '| | Use for |',
          '| --- | --- |',
          '| `Sheet` | Detail or a long form, opened from a list, keeping the list behind it |',
          '| `Dialog` | A short decision or a small form; becomes a bottom sheet under `sm` |',
          '| `AlertDialog` | Confirming something irreversible; the overlay does not dismiss it |',
          '',
          '### The footer sticks',
          '',
          'It sits *inside* the panel rather than after it, so it stays visible while the body scrolls. On a phone an Approve button that requires scrolling a 40-field form to reach is a button that gets missed, and it pads for the home indicator via `pb-safe-bottom`.',
          '',
          '### Sides',
          '',
          '`right` is the default and the right answer for detail in a left-to-right reading order. `bottom` is what to use when the same panel has to work one-handed on a phone, it puts the content and its actions in the thumb zone.',
          '',
          '### Swipe to dismiss',
          '',
          'On a coarse pointer the panel can be dragged toward its own edge to close, and a grab handle appears on a bottom or top sheet to say so. This is on by default for a finger and off for a mouse, which is a decision about the pointer and not about the screen: a thumb has no Escape key and often cannot reach a close button at the top of a full-height panel. Override with `swipeToDismiss`.',
          '',
          'Three details make it feel like an object rather than an animation:',
          '',
          '- **It decides on velocity, not distance.** A short flick dismisses; a long slow drag that stops before you lift returns to rest. The release velocity is projected forward with the same exponential decay a scroll view uses, and the panel goes wherever that projection lands.',
          '- **It hands that velocity to the spring.** The panel keeps moving at the speed your finger was moving, so there is no seam where the drag ends and the animation begins.',
          '- **The content gets first refusal.** Dragging down through a list that is scrolled halfway scrolls the list. The panel only starts to move once that list is back at its top.',
          '',
          'Dragging past the open position resists rather than stopping dead, and the whole gesture is disabled under `prefers-reduced-motion`, where the close button and Escape carry the dismissal instead.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    side: {
      description:
        'Which edge the panel is anchored to, and therefore which way it travels. `auto` is a floating side panel at a desk and a bottom sheet under a finger.',
      control: 'inline-radio',
      options: ['auto', 'right', 'left', 'top', 'bottom'],
      table: {
        type: { summary: "'auto' | 'right' | 'left' | 'top' | 'bottom'" },
        defaultValue: { summary: 'auto' },
        category: 'Layout',
      },
    },
    size: {
      description:
        'Width for the vertical edges, height for the horizontal ones. Below `sm` a left/right sheet is always full width, a 24rem panel on a 375px screen is a modal with a useless sliver of list behind it.',
      control: 'inline-radio',
      options: ['sm', 'md', 'lg', 'full'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg' | 'full'" },
        defaultValue: { summary: 'md' },
        category: 'Layout',
      },
    },
    showCloseButton: {
      description:
        'The ✕ in the corner. Keep it: Escape is not discoverable, and on a touch device there is no Escape key at all.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'true' },
        category: 'Behaviour',
      },
    },
    onEscapeKeyDown: {
      description: 'Call `preventDefault()` to keep a sheet with unsaved changes open.',
      control: false,
      table: { type: { summary: '(event: KeyboardEvent) => void' }, category: 'Behaviour' },
    },
    onPointerDownOutside: {
      description: 'Same, for a click on the overlay.',
      control: false,
      table: { type: { summary: '(event) => void' }, category: 'Behaviour' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { side: 'auto', size: 'md', showCloseButton: true },
} satisfies Meta<typeof SheetContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A label and its value, as a sheet lists a record's facts. */
function Facts({ rows }: { rows: readonly (readonly [string, string])[] }): JSX.Element {
  return (
    <dl className="divide-y divide-border">
      {rows.map(([term, value]) => (
        <div
          key={term}
          className="flex min-h-11 items-center justify-between gap-4 py-2 touch:min-h-13"
        >
          <dt className="text-sm text-fg-muted">{term}</dt>
          <dd className="text-right text-base font-medium text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const Playground: Story = {
  render: (args) => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="primary">Open sheet</Button>
      </SheetTrigger>
      <SheetContent {...args}>
        <SheetHeader>
          <SheetTitle>Priya Shah</SheetTitle>
          <SheetDescription>Senior Engineer</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <Facts
            rows={[
              ['Team', 'Engineering'],
              ['Manager', 'Jonas Weber'],
              ['Location', 'Berlin'],
            ]}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  ),
};

export const Sides: Story = {
  name: 'Every side',
  parameters: {
    docs: {
      description: {
        story:
          'Each panel travels along the edge it is anchored to, and leaves the same way, which is what keeps a mental model of where it went. `bottom` is the default on a phone; `top` is rare, for search.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-wrap gap-2">
      {(['right', 'left', 'top', 'bottom'] as const).map((side) => (
        <Sheet key={side}>
          <SheetTrigger asChild>
            <Button>{side}</Button>
          </SheetTrigger>
          <SheetContent {...args} side={side}>
            <SheetHeader>
              <SheetTitle>From the {side}</SheetTitle>
              <SheetDescription>
                It leaves the way it arrived, so the user knows where it went.
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="text-base text-fg-muted">Anchored to the {side} edge.</SheetBody>
          </SheetContent>
        </Sheet>
      ))}
    </div>
  ),
};

const queue = [
  {
    name: 'Amara Okafor',
    kind: 'Vacation',
    days: 5,
    dates: '14–18 Oct',
    balance: '9.5 days',
    cover: 'Omar Haddad',
  },
  {
    name: 'Lucas Moreau',
    kind: 'Sick leave',
    days: 2,
    dates: '2–3 Oct',
    balance: '8 days',
    cover: 'Tom Fischer',
  },
  {
    name: 'Mei Tanaka',
    kind: 'Vacation',
    days: 3,
    dates: '21–23 Oct',
    balance: '14 days',
    cover: 'Zara Ahmed',
  },
  {
    name: 'Sofia Lindqvist',
    kind: 'Parental leave',
    days: 20,
    dates: '1–28 Nov',
    balance: '20 days',
    cover: 'Nora Becker',
  },
];

export const RecordDetail: Story = {
  name: 'A record opened from a queue',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'The real case, working. Open any row: the queue stays behind the panel, the decision stays pinned to the bottom, and closing returns focus to the row that opened it: try it with the keyboard alone.',
      },
    },
  },
  render: function QueueStory(args) {
    const [decided, setDecided] = useState<Record<string, 'approved' | 'declined'>>({});

    return (
      <div className="mx-auto max-w-2xl divide-y divide-border rounded-lg bg-surface shadow-sm">
        {queue.map((request, index) => (
          <div key={request.name} className="flex items-center gap-3 p-3">
            <Avatar size="sm" name={request.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium text-fg">{request.name}</p>
              <p className="text-sm text-fg-muted">
                {request.kind} · {request.days} days
              </p>
            </div>
            {decided[request.name] ? (
              <Badge
                tone={decided[request.name] === 'approved' ? 'success' : 'danger'}
                size="sm"
                dot
              >
                {decided[request.name] === 'approved' ? 'Approved' : 'Declined'}
              </Badge>
            ) : (
              <Sheet>
                <SheetTrigger asChild>
                  <Button size="sm">Review</Button>
                </SheetTrigger>
                <SheetContent {...args}>
                  <SheetHeader>
                    <SheetTitle>
                      Request {index + 1} of {queue.length}
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                      {request.kind} for {request.name}
                    </SheetDescription>
                  </SheetHeader>
                  <SheetBody className="space-y-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar size="lg" name={request.name} />
                      <div>
                        <p className="text-base font-bold text-fg">{request.name}</p>
                        <p className="text-sm text-fg-muted">
                          {request.kind} · {request.days} days
                        </p>
                      </div>
                    </div>
                    <Facts
                      rows={[
                        ['Dates', request.dates],
                        ['Balance after', request.balance],
                        ['Cover', request.cover],
                      ]}
                    />
                    <p className="flex gap-3 text-xs text-fg-muted touch:hidden">
                      <span>
                        <Kbd>J</Kbd> next
                      </span>
                      <span>
                        <Kbd>K</Kbd> previous
                      </span>
                    </p>
                  </SheetBody>
                  <SheetFooter>
                    <SheetClose asChild>
                      <Button
                        onClick={() => {
                          setDecided((current) => ({ ...current, [request.name]: 'declined' }));
                        }}
                      >
                        Decline
                      </Button>
                    </SheetClose>
                    <SheetClose asChild>
                      <Button
                        variant="primary"
                        onClick={() => {
                          setDecided((current) => ({ ...current, [request.name]: 'approved' }));
                        }}
                      >
                        Approve
                      </Button>
                    </SheetClose>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            )}
          </div>
        ))}
      </div>
    );
  },
};

const leaveTypes = [
  'Vacation',
  'Sick leave',
  'Parental leave',
  'Unpaid leave',
  'Bereavement',
  'Study leave',
  'Jury service',
  'Volunteering day',
  'Moving day',
  'Compassionate leave',
  'Time off in lieu',
  'Public holiday swap',
];

export const SwipeToDismiss: Story = {
  name: 'Swipe to dismiss',
  parameters: {
    docs: {
      description: {
        story: [
          'A bottom sheet with the gesture forced on, so it can be tried with a mouse. In the product it is enabled by pointer type, not by this prop. Past a third of its height, or on a fast flick, it closes.',
          '',
          'Things worth trying, because each one is a separate decision in the hook:',
          '',
          '- **Flick down a short way and let go.** It dismisses, even though it never travelled far. Intent is in the velocity.',
          '- **Drag it a long way down, pause, then let go.** It returns. You stopped, so you changed your mind.',
          '- **Drag it upward.** It resists instead of stopping dead, and cannot be dismissed that way, a panel leaves by the edge it arrived from.',
          '- **Scroll the list, then drag down from inside it.** The list scrolls. Only once it is back at the top does the panel start to move.',
          '- **Flick it away and grab it again mid-flight.** It follows your finger from wherever it had got to, rather than snapping back and starting over.',
        ].join('\n'),
      },
    },
  },
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button>Choose a leave type</Button>
      </SheetTrigger>
      {/* `swipeToDismiss` is forced here purely so the story is usable with a
          mouse. Leaving it unset is correct in real screens: the default already
          asks the right question, which is what the pointer is. */}
      <SheetContent side="bottom" size="md" swipeToDismiss>
        <SheetHeader>
          <SheetTitle>Leave type</SheetTitle>
          <SheetDescription>Drag the handle down, or flick the panel away.</SheetDescription>
        </SheetHeader>
        <SheetBody>
          {/* Deliberately long. The interesting case is a drag that starts
              inside a scrolled list, which needs a list worth scrolling. */}
          <ul className="divide-y divide-border">
            {leaveTypes.map((type) => (
              <li key={type} className="flex min-h-12 items-center text-base text-fg">
                {type}
              </li>
            ))}
          </ul>
        </SheetBody>
      </SheetContent>
    </Sheet>
  ),
};

export const UnsavedChanges: Story = {
  name: 'Guarding unsaved changes',
  parameters: {
    docs: {
      description: {
        story:
          'Change the job title, then press Escape or click the overlay: while the form is dirty, dismissal asks first. This is the one legitimate reason to block a dismissal, and the guard has to be released once the form is clean, or the sheet becomes a trap.',
      },
    },
  },
  render: function GuardStory(args) {
    const saved = 'Staff Engineer';
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState(saved);
    const [asking, setAsking] = useState(false);
    const dirty = title !== saved;

    const guard = (event: Event): void => {
      if (dirty) {
        event.preventDefault();
        setAsking(true);
      }
    };

    return (
      <>
        <Sheet
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setTitle(saved);
          }}
        >
          <SheetTrigger asChild>
            <Button variant="primary">Edit profile</Button>
          </SheetTrigger>
          <SheetContent {...args} onEscapeKeyDown={guard} onPointerDownOutside={guard}>
            <SheetHeader>
              <SheetTitle>Edit profile</SheetTitle>
              <SheetDescription>Changes apply once you save them.</SheetDescription>
            </SheetHeader>
            <SheetBody>
              <Field>
                <FieldLabel>Job title</FieldLabel>
                <Input
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                />
              </Field>
            </SheetBody>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="primary" disabled={!dirty}>
                  Save
                </Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <AlertDialog open={asking} onOpenChange={setAsking}>
          <AlertDialogContent>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>You changed the job title.</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button>Keep editing</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setTitle(saved);
                    setOpen(false);
                  }}
                >
                  Discard
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  },
};
