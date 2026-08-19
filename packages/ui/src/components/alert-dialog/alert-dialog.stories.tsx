import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/button';
import { Input } from '../input/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';

const meta = {
  title: 'Components/AlertDialog',
  component: AlertDialogContent,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Confirmation for something that cannot be undone.',
          '',
          '### Not a `Dialog` with different buttons',
          '',
          'The roles differ, and the difference is load-bearing:',
          '',
          '- it is `role="alertdialog"`, so a screen reader announces the description **immediately** rather than waiting to be asked;',
          '- the overlay does not dismiss it, a stray click cannot confirm or cancel;',
          '- focus lands on **Cancel**, not on the destructive action, so a stray Enter cannot terminate an employee.',
          '',
          '### Use it sparingly',
          '',
          'A confirmation on a reversible action trains people to click through the one that matters. Before adding one, ask whether an undo would serve better: "Request withdrawn. Undo" in a toast is a better product than a modal that asks "are you sure?" nine times a day.',
          '',
          'Reserve it for the genuinely irreversible: terminating employment, deleting a record with a statutory retention period, submitting a pay run to a bank.',
          '',
          '### Say what will happen',
          '',
          'The description is the whole component. "This cannot be undone" is a warning; "This ends Grace Hopper\'s employment on 30 September, stops payroll from October, and revokes access at midnight" is information a person can decide on.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    onEscapeKeyDown: {
      description: 'Escape still cancels. Do not block it, that would leave no keyboard way out.',
      control: false,
      table: { type: { summary: '(event: KeyboardEvent) => void' }, category: 'Behaviour' },
    },
    forceMount: {
      description: 'Keeps the content mounted for an external animation library. Rarely needed.',
      control: false,
      table: { type: { summary: 'boolean' }, category: 'Behaviour' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {},
} satisfies Meta<typeof AlertDialogContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Delete draft</Button>
      </AlertDialogTrigger>
      <AlertDialogContent {...args}>
        <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
        <AlertDialogDescription>
          The draft offer for Katherine Johnson will be removed. Nothing has been sent to her, so
          nobody else is affected.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button>Keep draft</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive">Delete draft</Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
};

export const ConsequencesSpelledOut: Story = {
  name: 'Consequences spelled out',
  parameters: {
    docs: {
      description: {
        story:
          'Compare the two triggers. The first asks "are you sure?"; the second says what will happen, to whom, and when. Only the second is a decision a person can actually make, and the difference costs one sentence.',
      },
    },
  },
  render: (args) => (
    <div className="flex flex-wrap gap-3">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button>The lazy version</Button>
        </AlertDialogTrigger>
        <AlertDialogContent {...args}>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button>Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive">Continue</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">End employment</Button>
        </AlertDialogTrigger>
        <AlertDialogContent {...args}>
          <AlertDialogTitle>End Grace Hopper&apos;s employment?</AlertDialogTitle>
          <AlertDialogDescription>
            Employment ends on 30 September 2026. Payroll stops from the October run, system access
            is revoked at midnight on the last day, and 12 days of accrued leave will be paid out.
            Her record is retained for 6 years under the Spanish statutory floor and cannot be
            deleted before then.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button>Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive">End employment</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  ),
};

export const TypeToConfirm: Story = {
  name: 'Type to confirm',
  parameters: {
    docs: {
      description: {
        story:
          'For the small number of actions that are catastrophic rather than merely irreversible: submitting a pay run to a bank, deleting a legal entity. The friction is the point: it converts a reflex into a decision. Used on anything less than that. It is theatre.',
      },
    },
  },
  render: function TypeToConfirmStory(args) {
    const [typed, setTyped] = useState('');
    const phrase = 'SUBMIT AUGUST';

    return (
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setTyped('');
        }}
      >
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Submit pay run to the bank</Button>
        </AlertDialogTrigger>
        <AlertDialogContent {...args}>
          <AlertDialogTitle>Submit the August pay run?</AlertDialogTitle>
          <AlertDialogDescription>
            912 payments totalling €983,450.00 will be sent to Banco Santander for value date 31
            August 2026. Once submitted, payments cannot be recalled from this system, a reversal
            has to be arranged with the bank directly.
          </AlertDialogDescription>
          <div className="mt-4 space-y-1.5">
            <label htmlFor="confirm-phrase" className="text-sm text-fg-muted">
              Type <span className="font-mono font-medium text-fg">{phrase}</span> to confirm
            </label>
            <Input
              id="confirm-phrase"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button>Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" disabled={typed !== phrase}>
                Submit to bank
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  },
};

export const PreferUndo: Story = {
  name: 'When an undo is better',
  parameters: {
    docs: {
      description: {
        story:
          'Withdrawing a leave request is reversible, so it gets no modal at all. It happens, and an undo is offered. This story is here to be the counter-example: most confirmations in an HRIS should look like this instead.',
      },
    },
  },
  render: function UndoStory() {
    const [withdrawn, setWithdrawn] = useState(false);

    return (
      <div className="flex min-h-24 flex-col items-center gap-3">
        {withdrawn ? (
          <div
            role="status"
            className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-base text-fg"
          >
            Request withdrawn.
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                setWithdrawn(false);
              }}
            >
              Undo
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => {
              setWithdrawn(true);
            }}
          >
            Withdraw request
          </Button>
        )}
      </div>
    );
  },
};
