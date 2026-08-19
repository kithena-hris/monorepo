import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Money } from '../money/money';
import { Separator } from '../separator/separator';
import { Timeline, TimelineItem } from '../timeline/timeline';
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
      description: 'Which edge the panel is anchored to, and therefore which way it travels.',
      control: 'inline-radio',
      options: ['right', 'left', 'top', 'bottom'],
      table: {
        type: { summary: "'right' | 'left' | 'top' | 'bottom'" },
        defaultValue: { summary: 'right' },
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
  args: { side: 'right', size: 'md', showCloseButton: true },
} satisfies Meta<typeof SheetContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="primary">Open sheet</Button>
      </SheetTrigger>
      <SheetContent {...args}>
        <SheetHeader>
          <SheetTitle>Grace Hopper</SheetTitle>
          <SheetDescription>Principal Engineer · Platform · Madrid</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-3 text-base text-fg-muted">
          <p>
            The body scrolls; the header and footer do not. Resize the window shorter to see it.
          </p>
          {Array.from({ length: 12 }, (_, i) => (
            <p key={i}>Detail line {i + 1}.</p>
          ))}
        </SheetBody>
        <SheetFooter>
          <SheetClose asChild>
            <Button>Close</Button>
          </SheetClose>
          <Button variant="primary">Save</Button>
        </SheetFooter>
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
          'Each panel travels along the edge it is anchored to, and leaves the same way, which is what keeps a mental model of where it went. `bottom` is the one to reach for on a phone.',
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

export const RecordDetail: Story = {
  name: 'A record opened from a queue',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'The real case, working. Open any row: the queue stays behind the panel, the approve/reject actions stay pinned to the bottom, and closing returns focus to the row that opened it: try it with the keyboard alone.',
      },
    },
  },
  render: function QueueStory(args) {
    const queue = [
      { name: 'Grace Hopper', kind: 'Annual leave', days: 3, from: '14 September', balance: '12' },
      { name: 'Ada Lovelace', kind: 'Parental leave', days: 20, from: '1 October', balance: '18' },
      {
        name: 'Katherine Johnson',
        kind: 'Unpaid leave',
        days: 10,
        from: '1 October',
        balance: '4',
      },
    ];
    const [decided, setDecided] = useState<Record<string, 'approved' | 'rejected'>>({});

    return (
      <div className="mx-auto max-w-2xl divide-y divide-border rounded-lg border border-border bg-surface">
        {queue.map((request) => (
          <div key={request.name} className="flex items-center gap-3 p-3">
            <Avatar size="sm" name={request.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium text-fg">{request.name}</p>
              <p className="text-sm text-fg-muted">
                {request.kind} · {request.days} days from {request.from}
              </p>
            </div>
            {decided[request.name] ? (
              <Badge
                tone={decided[request.name] === 'approved' ? 'success' : 'danger'}
                size="sm"
                dot
              >
                {decided[request.name] === 'approved' ? 'Approved' : 'Rejected'}
              </Badge>
            ) : (
              <Sheet>
                <SheetTrigger asChild>
                  <Button size="sm">Review</Button>
                </SheetTrigger>
                <SheetContent {...args} size="lg">
                  <SheetHeader>
                    <SheetTitle>{request.name}</SheetTitle>
                    <SheetDescription>
                      {request.kind} · {request.days} days from {request.from}
                    </SheetDescription>
                  </SheetHeader>
                  <SheetBody className="space-y-5">
                    <dl className="grid grid-cols-2 gap-4 text-base">
                      <div>
                        <dt className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                          Balance after approval
                        </dt>
                        <dd className="mt-1 tabular-nums text-fg">{request.balance} days</dd>
                      </div>
                      <div>
                        <dt className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                          Payroll impact
                        </dt>
                        <dd className="mt-1 text-fg">
                          {request.kind === 'Unpaid leave' ? (
                            <Money minorUnits="-142000" currency="EUR" locale="en-IE" />
                          ) : (
                            'None'
                          )}
                        </dd>
                      </div>
                    </dl>
                    <Separator />
                    <div>
                      <p className="mb-3 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                        History
                      </p>
                      <Timeline>
                        <TimelineItem title="Submitted" timestamp="7 Aug, 11:02" tone="accent" />
                        <TimelineItem
                          title="Manager approved"
                          timestamp="7 Aug, 16:20"
                          tone="success"
                        />
                        <TimelineItem title="Awaiting your review" tone="warning" last />
                      </Timeline>
                    </div>
                  </SheetBody>
                  <SheetFooter>
                    <SheetClose asChild>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          setDecided((current) => ({ ...current, [request.name]: 'rejected' }));
                        }}
                      >
                        Reject
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

export const SwipeToDismiss: Story = {
  name: 'Swipe to dismiss',
  parameters: {
    docs: {
      description: {
        story: [
          'A bottom sheet with the gesture forced on, so it can be tried with a mouse. In the product it is enabled by pointer type, not by this prop.',
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
        <Button>Open a draggable sheet</Button>
      </SheetTrigger>
      {/* `swipeToDismiss` is forced here purely so the story is usable with a
          mouse. Leaving it unset is correct in real screens: the default already
          asks the right question, which is what the pointer is. */}
      <SheetContent side="bottom" size="md" swipeToDismiss>
        <SheetHeader>
          <SheetTitle>Team on leave</SheetTitle>
          <SheetDescription>Drag the handle, or flick the panel down.</SheetDescription>
        </SheetHeader>
        <SheetBody>
          {/* Deliberately long. The interesting case is a drag that starts
              inside a scrolled list, which needs a list worth scrolling. */}
          <ul className="space-y-3">
            {Array.from({ length: 24 }, (_, index) => (
              <li key={index} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={`Person ${String(index + 1)}`} size="sm" />
                  <div>
                    <p className="text-base font-medium text-fg">Person {index + 1}</p>
                    <p className="text-sm text-fg-muted">Annual leave</p>
                  </div>
                </div>
                <Badge tone={index % 3 === 0 ? 'warning' : 'success'}>
                  {index % 3 === 0 ? 'Pending' : 'Approved'}
                </Badge>
              </li>
            ))}
          </ul>
        </SheetBody>
        <SheetFooter>
          <SheetClose asChild>
            <Button>Close</Button>
          </SheetClose>
        </SheetFooter>
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
          'Type something, then press Escape or click the overlay: both are intercepted while the form is dirty. This is the one legitimate reason to block a dismissal, and the guard has to be released once the form is clean, or the sheet becomes a trap.',
      },
    },
  },
  render: function GuardStory(args) {
    const [note, setNote] = useState('');
    const [warned, setWarned] = useState(false);
    const dirty = note.trim().length > 0;

    return (
      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            setNote('');
            setWarned(false);
          }
        }}
      >
        <SheetTrigger asChild>
          <Button variant="primary">Add a note</Button>
        </SheetTrigger>
        <SheetContent
          {...args}
          onEscapeKeyDown={(event) => {
            if (dirty) {
              event.preventDefault();
              setWarned(true);
            }
          }}
          onPointerDownOutside={(event) => {
            if (dirty) {
              event.preventDefault();
              setWarned(true);
            }
          }}
        >
          <SheetHeader>
            <SheetTitle>Note on this request</SheetTitle>
            <SheetDescription>
              Visible to the employee once the request is decided.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-3">
            <textarea
              aria-label="Note"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setWarned(false);
              }}
              rows={5}
              className="w-full rounded-md border border-border bg-surface p-3 text-base text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              placeholder="Type here, then try to dismiss with Escape."
            />
            {warned ? (
              <p role="alert" className="text-sm font-medium text-warning-fg">
                This note has not been saved. Save it, or clear the field to discard.
              </p>
            ) : null}
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild>
              <Button
                onClick={() => {
                  setNote('');
                }}
              >
                Discard
              </Button>
            </SheetClose>
            <SheetClose asChild>
              <Button variant="primary" disabled={!dirty}>
                Save note
              </Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  },
};
