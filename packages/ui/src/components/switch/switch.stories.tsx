import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Badge } from '../badge/badge';
import { Separator } from '../separator/separator';
import { Switch } from './switch';

const meta = {
  title: 'Forms/Switch',
  component: Switch,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Immediate on/off.',
          '',
          '### The rule',
          '',
          '**A switch commits the moment it moves.** If the setting needs a Save button. It is a `Checkbox`, not a switch, and a form full of switches with a Save button at the bottom is a form that lies about when it took effect. That distinction matters more in an HRIS than in most products: "notify the employee" is a switch that sends an email, and there is no undo on a sent email.',
          '',
          '| Control | Commits | Label describes |',
          '| --- | --- | --- |',
          '| `Switch` | Immediately | A state that is now on or off |',
          '| `Checkbox` | On submit | A value included in the form |',
          '| `Toggle` | Immediately, but it is a button | An action whose pressed state is the setting |',
          '',
          '### Labelling',
          '',
          'A switch has no visible text of its own, so it always needs either a `<label htmlFor>` or an `aria-label`. Label the *state*, not the act: "Two-factor authentication", not "Enable two-factor authentication". The latter reads as "Enable two-factor authentication, on".',
          '',
          '### Pending states',
          '',
          'Because it commits immediately, the interesting case is failure. The last story shows the honest pattern: move optimistically, disable while in flight, and roll back visibly if the server refuses.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    checked: {
      description: 'Controlled state. Pair with `onCheckedChange`.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    defaultChecked: {
      description: 'Uncontrolled starting state.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    onCheckedChange: {
      description: 'Fires with the new state. This is where the write happens: immediately.',
      control: false,
      table: { type: { summary: '(checked: boolean) => void' }, category: 'State' },
    },
    disabled: {
      description: 'Blocks interaction. Use it while a change is in flight, and say why nearby.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    required: {
      description: 'Native form validation. Rare on a switch, an "off" switch is usually valid.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, defaultValue: { summary: 'false' }, category: 'Form' },
    },
    name: {
      description: 'Form field name, for an uncontrolled `<form>` submit.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Form' },
    },
    value: {
      description: 'Submitted value when checked. Defaults to `"on"`, as in HTML.',
      control: 'text',
      table: { type: { summary: 'string' }, defaultValue: { summary: 'on' }, category: 'Form' },
    },
    'aria-label': {
      description: 'Required unless a visible `<label htmlFor>` points at it.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    defaultChecked: true,
    disabled: false,
    'aria-label': 'Two-factor authentication',
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithALabel: Story = {
  name: 'With a label',
  parameters: {
    docs: {
      description: {
        story:
          'The label is a real `<label htmlFor>`, so clicking the text flips the switch, which is most of the target area, and the only reason this is usable on a phone.',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-3">
      <Switch id="notify" defaultChecked />
      <label htmlFor="notify" className="cursor-pointer text-base text-fg select-none">
        Notify the employee by email
      </label>
    </div>
  ),
};

export const SettingsList: Story = {
  name: 'A settings list',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'The shape a settings screen actually takes: label, consequence, control, with the control at the trailing edge where a right thumb reaches it. Every one of these commits on flip, which is exactly why each has a sentence explaining what flipping it does.',
      },
    },
  },
  render: () => (
    <div className="mx-auto max-w-lg divide-y divide-border rounded-lg border border-border bg-surface">
      {(
        [
          [
            'employee-notifications',
            'Notify employees of approvals',
            'Sends an email the moment a request is approved or rejected. There is no undo on a sent email.',
            true,
          ],
          [
            'manager-digest',
            'Weekly manager digest',
            'Monday morning summary of pending approvals for every manager with a direct report.',
            true,
          ],
          [
            'auto-approve',
            'Auto-approve leave under 1 day',
            'Requests of half a day or less skip the manager and are approved on submission.',
            false,
          ],
          [
            'calendar-sync',
            'Push approved leave to calendars',
            "Writes an all-day event to the employee's work calendar. Requires the Google Workspace connection.",
            false,
          ],
        ] as const
      ).map(([id, label, description, checked]) => (
        <div key={id} className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <label htmlFor={id} className="cursor-pointer text-base font-medium text-fg">
              {label}
            </label>
            <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
          </div>
          <Switch id={id} defaultChecked={checked} className="mt-1 shrink-0" />
        </div>
      ))}
    </div>
  ),
};

export const Disabled: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A setting fixed by something other than the user. The reason is beside it, a switch that cannot be moved and does not explain itself is a support ticket.',
      },
    },
  },
  render: () => (
    <div className="max-w-md space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor="sso" className="text-base font-medium text-fg">
            Single sign-on required
          </label>
          <p className="mt-0.5 text-sm text-fg-muted">
            Enforced by your identity provider. Change it in Okta.
          </p>
        </div>
        <Switch id="sso" defaultChecked disabled className="mt-1" />
      </div>
      <Separator />
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor="retention" className="text-base font-medium text-fg">
            Delete records after termination
          </label>
          <p className="mt-0.5 text-sm text-fg-muted">
            Blocked by the Spanish statutory retention floor.
          </p>
        </div>
        <Switch id="retention" disabled className="mt-1" />
      </div>
    </div>
  ),
};

export const Pending: Story = {
  name: 'Committing, and failing',
  parameters: {
    docs: {
      description: {
        story:
          'The case a switch has to get right. It moves optimistically, disables while the write is in flight, and rolls back *visibly* with a message when the server refuses. A switch that silently snaps back is indistinguishable from a broken finger.',
      },
    },
  },
  render: function PendingStory() {
    const [checked, setChecked] = useState(false);
    const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle');

    return (
      <div className="max-w-md space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <label htmlFor="payroll-lock" className="text-base font-medium text-fg">
              Lock the August pay run
            </label>
            <p className="mt-0.5 text-sm text-fg-muted">
              Stops further edits. Reversible until the run is submitted to the bank.
            </p>
          </div>
          <div className="mt-1 flex shrink-0 items-center gap-2">
            {state === 'saving' ? <Badge size="sm">Saving…</Badge> : null}
            <Switch
              id="payroll-lock"
              checked={checked}
              disabled={state === 'saving'}
              onCheckedChange={(next) => {
                setChecked(next);
                setState('saving');
                // Stand-in for the mutation. The second flip fails, to show
                // the rollback rather than only the happy path.
                setTimeout(() => {
                  if (next) {
                    setState('idle');
                  } else {
                    setChecked(true);
                    setState('failed');
                  }
                }, 900);
              }}
            />
          </div>
        </div>
        {state === 'failed' ? (
          <p role="alert" className="text-sm font-medium text-danger-fg">
            Could not unlock: the run has already been sent to the bank. The switch has been put
            back.
          </p>
        ) : null}
      </div>
    );
  },
};
