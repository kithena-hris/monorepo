import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Alert } from '../feedback/feedback';
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
    title: 'Leave approved',
    description: '3 days from 14 September. Grace Hopper has been notified.',
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
          'Each tone with the message it is actually for. Fire several: they stack, and the newest is closest to the edge the finger reaches first.',
      },
    },
  },
  render: function TonesStory() {
    const { toast } = useToast();
    const examples: { tone: ToastTone; title: string; description: string }[] = [
      {
        tone: 'success',
        title: 'Leave approved',
        description: '3 days from 14 September. Grace Hopper has been notified.',
      },
      {
        tone: 'info',
        title: 'Import queued',
        description: 'You will get an email when the 4,182 rows have been processed.',
      },
      {
        tone: 'warning',
        title: 'Approved over balance',
        description: "Ada Lovelace is now 2 days into next year's entitlement.",
      },
      {
        tone: 'danger',
        title: 'Could not save',
        description: 'The record changed while you were editing it.',
      },
      {
        tone: 'neutral',
        title: 'Draft saved',
        description: 'Nothing has been submitted yet.',
      },
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
    const [rows, setRows] = useState(['Grace Hopper', 'Ada Lovelace', 'Katherine Johnson']);

    return (
      <div className="w-80 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-fg-muted">All requests cleared.</p>
        ) : (
          rows.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <span className="text-base text-fg">{name}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const remaining = rows.filter((row) => row !== name);
                  setRows(remaining);
                  toast({
                    title: 'Request withdrawn',
                    description: `${name}'s request has been withdrawn.`,
                    action: {
                      label: 'Undo',
                      onClick: () => {
                        setRows((current) => [...current, name].toSorted());
                      },
                    },
                  });
                }}
              >
                Withdraw
              </Button>
            </div>
          ))
        )}
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
            title: 'Could not reach the payroll provider',
            description: 'The August run has not been submitted.',
            duration: Infinity,
            action: {
              label: 'Retry',
              onClick: () => {
                toast({ tone: 'info', title: 'Retrying…' });
              },
            },
          });
        }}
      >
        Trigger a failure
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
          'The same failure, twice. The toast is gone in five seconds and cannot be re-read; the alert stays on the page, names the four employees, and can be linked to. Anything a person has to *act on* belongs in the second form.',
      },
    },
  },
  render: function NotAToastStory() {
    const { toast } = useToast();
    return (
      <div className="w-[28rem] space-y-4">
        <Button
          onClick={() => {
            toast({
              tone: 'danger',
              title: 'Payroll failed for 4 employees',
            });
          }}
        >
          Show it as a toast (wrong)
        </Button>

        <Alert tone="danger" title="Payroll failed for 4 employees">
          <p>
            Grace Hopper, Ada Lovelace, Joan Clarke and Katherine Johnson have no valid IBAN on
            file. The rest of the run completed.
          </p>
          <Button size="sm" variant="secondary" className="mt-3">
            Review the four records
          </Button>
        </Alert>
      </div>
    );
  },
};
