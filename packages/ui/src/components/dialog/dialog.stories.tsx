import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/button';
import { DatePicker } from '../date-picker/date-picker';
import { Field, FieldControl, FieldDescription, FieldLabel } from '../field/field';
import { Alert } from '../feedback/feedback';
import { Textarea } from '../input/input';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';

const meta = {
  title: 'Components/Dialog',
  component: Dialog,
  subcomponents: { DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter },
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          '**A modal interrupts.** Use one for a decision that blocks the task, not for detail that a side panel or a route could carry just as well, and never for something the user might want to keep open while working.',
          '',
          '### What the primitive guarantees',
          '',
          '- Focus moves into the dialog and is trapped there.',
          '- The rest of the page is inert to pointer and screen reader alike.',
          '- Escape and the overlay close it; focus returns to the trigger.',
          '',
          'All three are required for a modal to *be* a modal. This layer adds presentation and nothing else.',
          '',
          '### Writing one',
          '',
          '- The title states the decision, not the noun: "Approve leave request", not "Leave request".',
          '- The confirming button names the act, "Offboard", not "OK". A user who skimmed the title still reads the button.',
          '- Consequences go in the body, above the buttons, where they cannot be missed on the way past.',
          '- `DialogBody` scrolls at 60vh so a long form never pushes the footer off-screen on a laptop.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    open: {
      description: 'Controlled open state. Pair with `onOpenChange`.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    defaultOpen: {
      description: 'Uncontrolled starting state.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    modal: {
      description:
        "Whether the rest of the page is inert. Turning this off makes it a popover with a dialog's look: almost always wrong.",
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'true' },
        category: 'Behaviour',
      },
    },
    onOpenChange: { action: 'open changed', table: { category: 'Events' } },
  },
  args: { modal: true },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="primary">Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve leave request</DialogTitle>
          <DialogDescription>
            Grace Hopper, 14&ndash;18 September 2026. Four working days deducted from the 2026
            balance.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary">Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const WithAForm: Story = {
  name: 'With a form',
  parameters: {
    docs: {
      description: {
        story:
          'The body scrolls; the header and footer do not. On a 13-inch laptop the confirming button stays visible no matter how long the form grows.',
      },
    },
  },
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="primary">File a request</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File a leave request</DialogTitle>
          <DialogDescription>
            Recorded now, effective on the dates you choose. Both are stored.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 pb-4">
          <div className="grid grid-cols-2 gap-4">
            <Field required>
              <FieldLabel>First day</FieldLabel>
              <FieldControl>
                <DatePicker
                  label="First day of leave"
                  today="2026-08-10"
                  value="2026-09-14"
                  onChange={() => undefined}
                />
              </FieldControl>
            </Field>
            <Field required>
              <FieldLabel>Last day</FieldLabel>
              <FieldControl>
                <DatePicker
                  label="Last day of leave"
                  today="2026-08-10"
                  value="2026-09-18"
                  onChange={() => undefined}
                />
              </FieldControl>
            </Field>
          </div>
          <Field>
            <FieldLabel>Note for your manager</FieldLabel>
            <FieldControl>
              <Textarea autoResize placeholder="Optional" />
            </FieldControl>
            <FieldDescription>Stored on the request event, visible to approvers.</FieldDescription>
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" type="submit">
            File request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const Destructive: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The consequence is stated in the body, and the confirming button names the act. Both escapes. Cancel and the close button: are non-destructive.',
      },
    },
  },
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="destructive">Offboard employee</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Offboard Grace Hopper?</DialogTitle>
          <DialogDescription>
            Effective 30 September 2026. Access is revoked on the effective date, not now.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-4">
          <Alert tone="warning" title="This emits an event other modules consume">
            Payroll, entitlements and the directory all react to offboarding. Reversing it needs a
            superseding event, not an undo.
          </Alert>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Keep active</Button>
          </DialogClose>
          <Button variant="destructive">Offboard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const Controlled: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Open state owned by the caller: needed whenever the dialog must stay open through an async submit, or close only after the server confirms.',
      },
    },
  },
  render: function ControlledStory(args) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    return (
      <div className="space-y-3 text-center">
        <Dialog
          {...args}
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            args.onOpenChange?.(next);
          }}
        >
          <DialogTrigger asChild>
            <Button variant="primary">Approve request</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve leave request</DialogTitle>
              <DialogDescription>The dialog stays open until the write returns.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={saving}
                loadingLabel="Approving the request"
                onClick={() => {
                  setSaving(true);
                  setTimeout(() => {
                    setSaving(false);
                    setOpen(false);
                  }, 1200);
                }}
              >
                Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <p className="font-mono text-xs text-fg-muted">open: {String(open)}</p>
      </div>
    );
  },
};
