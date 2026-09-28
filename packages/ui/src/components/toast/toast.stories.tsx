import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../alert-dialog/alert-dialog';
import { Button } from '../button/button';
import { useToast, type ToastOptions, type ToastTone } from './toast';

const meta = {
  title: 'Components/Toast',
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Transient confirmation of something that already happened.',
          '',
          '### The constraint that matters',
          '',
          '**A toast may never be the only place a piece of information appears.** It disappears on a timer. It is easy to miss on a second monitor, and a screen-reader user hears it exactly once.',
          '',
          '"Leave approved" is a fine toast, because the row behind it also changed. "Payroll failed for 4 employees" is not. That is an `Alert` on the page, which persists, can be re-read, and can be linked to.',
          '',
          '### What the primitive handles',
          '',
          'Swipe to dismiss, pausing the timer on hover *and* on window blur (so a toast does not expire while the user is in another tab), and **F8** to jump to the toast region from anywhere. That last one is why a toast with an action is usable from the keyboard at all.',
          '',
          '### Setup',
          '',
          'Wrap the app once in `<ToastProvider>`, then call `useToast()` anywhere below it. The provider owns the queue rather than a module-level singleton, so two independently-sold modules mounted in the same shell do not fight over one global list.',
          '',
          '```tsx',
          'const { toast } = useToast();',
          "toast({ title: 'Leave approved', tone: 'success' });",
          '```',
          '',
          '### Duration',
          '',
          'Five seconds by default. Pass `Infinity` only for a failure that carries a retry, a pinned toast with no action is an alert that forgot where it lives.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    title: {
      description: 'The headline. Past tense, and specific: "Leave approved", not "Success".',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Content' },
    },
    description: {
      description: 'One optional supporting line. If it needs two, this is not a toast.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Content' },
    },
    tone: {
      description: 'Semantic colour and icon. The words still carry the meaning.',
      control: 'inline-radio',
      options: ['neutral', 'success', 'warning', 'danger', 'info'],
      table: {
        type: { summary: "'neutral' | 'success' | 'warning' | 'danger' | 'info'" },
        defaultValue: { summary: 'neutral' },
        category: 'Appearance',
      },
    },
    duration: {
      description: 'Milliseconds before it dismisses itself. `Infinity` pins it.',
      control: { type: 'number' },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '5000' },
        category: 'Behaviour',
      },
    },
    action: {
      description:
        'A single action, usually Undo or Retry. Its `label` is also the `altText` a screen reader hears, since it cannot see the button.',
      control: false,
      table: { type: { summary: '{ label: string; onClick: () => void }' }, category: 'Content' },
    },
  },
  args: {
    title: 'Request sent to Jonas',
    tone: 'success',
    duration: 5000,
  },
} satisfies Meta<ToastOptions>;

export default meta;

// Typed from the args shape rather than from `typeof meta`: this meta has no
// `component` (a toast is raised by a hook, not rendered), and without one
// Storybook cannot infer the args type from the meta object.
type Story = StoryObj<ToastOptions>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const { toast } = useToast();
    return (
      <Button
        variant="primary"
        onClick={() => {
          toast(args);
        }}
      >
        Show toast
      </Button>
    );
  },
};

export const Tones: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Each tone with the message it is actually for. Every one is the same dark bar in the same place; only the disc at its start changes. Fire several: they stack, and the newest is closest to the edge the finger reaches first.',
      },
    },
  },
  render: function TonesStory() {
    const { toast } = useToast();
    const examples: { tone: ToastTone; title: string }[] = [
      { tone: 'success', title: 'Saved' },
      { tone: 'info', title: 'Sync in progress' },
      { tone: 'warning', title: 'You’re offline' },
      { tone: 'danger', title: 'Couldn’t save' },
      { tone: 'neutral', title: 'Link copied' },
    ];

    return (
      <div className="flex flex-wrap gap-2">
        {examples.map((example) => (
          <Button
            key={example.tone}
            onClick={() => {
              toast(example);
            }}
          >
            {example.tone}
          </Button>
        ))}
      </div>
    );
  },
};

export const WithAnUndo: Story = {
  name: 'With an undo',
  parameters: {
    docs: {
      description: {
        story:
          'The pattern that should replace most confirmation modals: do the thing, then offer to put it back. Press **F8** to jump to the toast from the keyboard, without that, an action in a toast is unreachable for a keyboard user.',
      },
    },
  },
  render: function UndoStory() {
    const { toast } = useToast();
    const people = ['Amara Okafor', 'Lucas Moreau', 'Mei Tanaka'];
    const [archived, setArchived] = useState(false);

    return (
      <div className="w-80 space-y-3">
        <p className="text-sm text-fg-muted">
          {archived ? 'Archived: ' : 'Selected: '}
          {people.join(', ')}
        </p>
        <Button
          disabled={archived}
          onClick={() => {
            setArchived(true);
            toast({
              title: '3 people archived',
              description: 'They’re hidden from the directory.',
              action: {
                label: 'Undo',
                onClick: () => {
                  setArchived(false);
                },
              },
            });
          }}
        >
          Archive 3 people
        </Button>
      </div>
    );
  },
};

export const PinnedFailure: Story = {
  name: 'A failure with a retry',
  parameters: {
    docs: {
      description: {
        story:
          'The only case for `duration: Infinity`. The retry is what earns the pin, a pinned toast with nothing to do about it is an alert that ended up in the wrong component.',
      },
    },
  },
  render: function PinnedStory() {
    const { toast } = useToast();
    return (
      <Button
        variant="destructive"
        onClick={() => {
          toast({
            tone: 'danger',
            title: 'Couldn’t send payslips',
            description: 'The connection dropped at 226 of 312.',
            duration: Infinity,
            action: {
              label: 'Retry',
              onClick: () => {
                toast({ tone: 'info', title: 'Sending the remaining 86 payslips' });
              },
            },
          });
        }}
      >
        Send payslips
      </Button>
    );
  },
};

export const NotAToast: Story = {
  name: 'When it should not be a toast',
  parameters: {
    docs: {
      description: {
        story:
          'The same message, twice. If people must act on it, or would miss it, it is not a toast: the toast is gone in five seconds and cannot be re-read, while the dialog waits for an answer. Use a dialog, or an inline alert on the page.',
      },
    },
  },
  render: function NotAToastStory() {
    const { toast } = useToast();
    return (
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => {
            toast({ tone: 'danger', title: 'Your session expires in 1 minute' });
          }}
        >
          As a toast (wrong)
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button>As a dialog (right)</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Still there?</AlertDialogTitle>
            <AlertDialogDescription>You’ll be signed out in 1 minute.</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogAction asChild>
                <Button variant="primary">Stay signed in</Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  },
};
