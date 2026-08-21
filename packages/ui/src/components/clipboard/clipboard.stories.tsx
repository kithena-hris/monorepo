import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { Money } from '../money/money';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table/table';
import { CopyButton, CopyField, useClipboard } from './clipboard';

const meta = {
  title: 'Components/Clipboard',
  component: CopyButton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Copy to clipboard: a button, a field, and the hook underneath both.',
          '',
          '### Why this is not three lines at the call site',
          '',
          '`navigator.clipboard.writeText` is the easy part. The parts that get skipped:',
          '',
          "- **It rejects.** Outside a secure context (`http://` on a colleague's laptop), inside a cross-origin iframe without the permission, or when the user denies it. The naive version silently claims success; this one reports the failure and tells the user to press ⌘C.",
          '- **It needs a user gesture.** Copying from an effect or a `setTimeout` is blocked everywhere. The hook only hands back a function you call from a handler.',
          '- **Confirmation has to be announced.** A checkmark that swaps in for two seconds tells a sighted user it worked and a screen-reader user nothing. The state goes through a polite live region.',
          '- **The label must not resize.** "Copy" → "Copied" reflows the row under the cursor mid-click. Both labels are stacked in one grid cell, so the wider one sets the width and nothing moves.',
          '',
          '### No `execCommand` fallback',
          '',
          'Deliberately. It is deprecated. It needs a temporary DOM node that fights focus management, and it fails in the same contexts for the same reasons. Reporting the failure so the user can select the text themselves is more honest than a fallback that also quietly does nothing.',
          '',
          '### Which one to use',
          '',
          '| | For |',
          '| --- | --- |',
          '| `CopyButton` | A control beside something. Icon-only gets a tooltip and an `aria-label`. |',
          '| `CopyField` | A read-only value the user needs to take away: an id, an IBAN, an API token. |',
          '| `useClipboard` | Anything else, a whole row, a code block, a keyboard shortcut. |',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: {
      description: 'What lands on the clipboard. May be longer than what is displayed.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Data' },
    },
    children: {
      description: 'Visible label. Omit it for an icon-only button.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    label: {
      description: 'Accessible name, and the tooltip text when the button is icon-only.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Copy' },
        category: 'Accessibility',
      },
    },
    copiedLabel: {
      description: 'Confirmation, visible and announced.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Copied' },
        category: 'Content',
      },
    },
    errorLabel: {
      description:
        'Shown when the write is refused. Say what to do instead, the user still needs the value.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Press ⌘C to copy' },
        category: 'Content',
      },
    },
    resetAfter: {
      description: 'Milliseconds before the confirmation reverts.',
      control: { type: 'number' },
      table: {
        type: { summary: 'number' },
        defaultValue: { summary: '2000' },
        category: 'Behaviour',
      },
    },
    tooltip: {
      description:
        'Wraps an icon-only button in a tooltip. Ignored when a visible label is present.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'true' },
        category: 'Behaviour',
      },
    },
    onCopy: {
      description: 'Fires after a successful write. Use it for analytics, not for confirmation.',
      control: false,
      table: { type: { summary: '(text: string) => void' }, category: 'Behaviour' },
    },
    variant: {
      description: 'Inherited from `Button`.',
      control: 'inline-radio',
      options: ['ghost', 'secondary', 'primary', 'subtle'],
      table: {
        type: { summary: 'ButtonProps["variant"]' },
        defaultValue: { summary: 'ghost' },
        category: 'Appearance',
      },
    },
    size: {
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'sm' },
        category: 'Appearance',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    value: 'ES91 2100 0418 4502 0005 1332',
    children: 'Copy IBAN',
    label: 'Copy IBAN',
    resetAfter: 2000,
    tooltip: true,
    variant: 'secondary',
    size: 'md',
  },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const IconOnly: Story = {
  name: 'Icon only',
  args: { children: undefined },
  parameters: {
    docs: {
      description: {
        story:
          'No visible label, so the `label` prop becomes both the `aria-label` and the tooltip. The glyph cross-fades in a fixed 16px box, the button never changes size, which matters because the pointer is on it when the state changes.',
      },
    },
  },
  render: (args) => (
    <div className="flex items-center gap-3">
      <CopyButton {...args} value="EMP-004182" label="Copy employee id" />
      <CopyButton {...args} value="grace.hopper@acme.example" label="Copy email" variant="ghost" />
      <CopyButton
        {...args}
        value="ES91 2100 0418 4502 0005 1332"
        label="Copy IBAN"
        variant="primary"
      />
    </div>
  ),
};

export const Fields: Story = {
  name: 'CopyField',
  parameters: {
    docs: {
      description: {
        story:
          'The value is selectable text, not an `<input readonly>`. An input is announced as an editable field the user then cannot edit, and it takes a tab stop away from the button doing the actual work. `display` shortens what is shown while the full value goes to the clipboard: see the token.',
      },
    },
  },
  render: () => (
    <div className="max-w-md space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-fg">Employee id</p>
        <CopyField value="EMP-004182" label="Copy employee id" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-fg">IBAN</p>
        <CopyField value="ES91 2100 0418 4502 0005 1332" label="Copy IBAN" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-fg">Webhook secret</p>
        {/* Deliberately not a real provider's prefix followed by real-looking
            entropy. The previous fixture was `whsec_` and thirty-two hex
            characters, which is precisely the shape of a Stripe webhook signing
            secret — GitHub's secret scanner opened an alert on it the moment
            this repository became public. It was invented, but nothing about
            reading it says so, and a fixture that cannot be told apart from a
            leak costs someone an afternoon proving it is not one. */}
        <CopyField
          value="example-webhook-secret-not-a-real-credential"
          display="example-webho…ntial"
          label="Copy webhook secret"
        />
        <p className="text-xs text-fg-muted">
          Shown truncated; the whole secret is what gets copied.
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-fg">Not an identifier</p>
        <CopyField value="Grace Hopper" mono={false} label="Copy name" size="sm" />
      </div>
    </div>
  ),
};

export const InATable: Story = {
  name: 'In a table',
  parameters: {
    docs: {
      description: {
        story:
          'One per row, revealed on hover and on focus. The `aria-label` names the row it belongs to: forty buttons all called "Copy" is forty identical entries in a screen reader\'s control list.',
      },
    },
  },
  render: () => (
    <Table aria-label="Employees">
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Employee id</TableHead>
          <TableHead numeric>Base salary</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(
          [
            ['Grace Hopper', 'EMP-004182', '1420000'],
            ['Ada Lovelace', 'EMP-004183', '1285000'],
            ['Radia Perlman', 'EMP-004184', '1360000'],
          ] as const
        ).map(([name, id, salary]) => (
          <TableRow key={id} className="group">
            <TableCell className="font-medium">{name}</TableCell>
            <TableCell>
              <span className="flex items-center gap-1 font-mono text-xs">
                {id}
                <CopyButton
                  value={id}
                  label={`Copy the employee id for ${name}`}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"
                />
              </span>
            </TableCell>
            <TableCell numeric>
              <Money minorUnits={salary} currency="EUR" locale="en-IE" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const WithTheHook: Story = {
  name: 'useClipboard',
  parameters: {
    docs: {
      description: {
        story:
          'When the affordance is not a button. Here the whole code block is the target, and the hook supplies the state that drives its own confirmation. Note that `copy` is called from a click handler. It will not work from an effect, in any browser.',
      },
    },
  },
  render: function HookStory() {
    const snippet = `import { Money } from '@reach/ui';\n\n<Money minorUnits="1420000" currency="EUR" locale="en-IE" />`;
    const { status, copy } = useClipboard({ resetAfter: 1500 });

    return (
      <div className="max-w-xl space-y-2">
        <button
          type="button"
          onClick={() => {
            void copy(snippet);
          }}
          className="group relative w-full rounded-md border border-border bg-surface-sunken p-3 text-left transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <pre className="overflow-x-auto font-mono text-xs text-fg-muted">{snippet}</pre>
          <span
            aria-hidden
            className="absolute top-2 right-2 rounded-sm bg-surface px-1.5 py-0.5 text-2xs text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
          >
            {status === 'copied' ? 'Copied' : 'Click to copy'}
          </span>
          <span className="sr-only">Copy the code example</span>
        </button>
        <p aria-live="polite" className="text-xs text-fg-muted">
          {status === 'copied'
            ? 'Copied to the clipboard.'
            : status === 'error'
              ? 'The browser refused. Select the text and press ⌘C.'
              : ' '}
        </p>
      </div>
    );
  },
};

export const Failure: Story = {
  name: 'When it is refused',
  parameters: {
    docs: {
      description: {
        story:
          'The case nobody designs for. The clipboard API rejects on `http://`, inside a sandboxed iframe, and when permission is denied, and it is not rare, because internal tools get opened over plain HTTP more often than anyone admits. The button shows a ✕, keeps the value on screen, and says what to press instead.',
      },
    },
  },
  render: function FailureStory() {
    const [log, setLog] = useState<string | null>(null);
    const { status, copy } = useClipboard({
      onError: () => {
        setLog('Rejected. In a real page this is a permission or a secure-context failure.');
      },
    });
    // The refusal path, reached through the injected writer rather than by
    // stubbing `navigator`, which is read-only, and would leak into every
    // other story in the same browser.
    const refused = useClipboard({
      write: () => Promise.reject(new Error('NotAllowedError: write permission denied')),
      onError: () => {
        setLog('Rejected. In a real page this is a permission or a secure-context failure.');
      },
    });

    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Simulated refusal</CardTitle>
          <Badge
            size="sm"
            tone={status === 'error' || refused.status === 'error' ? 'danger' : 'neutral'}
            dot
          >
            {refused.status === 'idle' ? status : refused.status}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex items-center gap-2 font-mono text-xs text-fg-muted">
            <span className="select-all">ES91 2100 0418 4502 0005 1332</span>
            <CopyButton value="ES91 2100 0418 4502 0005 1332" label="Copy the IBAN" />
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                void copy('ES91 2100 0418 4502 0005 1332');
              }}
            >
              Copy (works here)
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void refused.copy('ES91 2100 0418 4502 0005 1332');
              }}
            >
              Force a refusal
            </Button>
          </div>
          {log ? <p className="text-xs text-danger-fg">{log}</p> : null}
        </CardContent>
      </Card>
    );
  },
};
