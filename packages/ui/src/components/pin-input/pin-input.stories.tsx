import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../button/button';
import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { CopyButton } from '../clipboard/clipboard';
import { Alert } from '../feedback/feedback';
import { PinInput } from './pin-input';

const meta = {
  title: 'Forms/PinInput',
  component: PinInput,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A one-time code, as separate boxes.',
          '',
          '### The one everyone gets wrong: paste',
          '',
          'Someone receives a six-digit code and pastes it. In most implementations the paste lands in a single box and the other five stay empty, so they retype it by hand, from a text message, on a phone, under a 30-second timer. Here the paste is split across the boxes from wherever it lands, non-digits are stripped, and focus moves to the end. Try it: copy `481502` and paste into the first box.',
          '',
          '### `autocomplete="one-time-code"`, on the first box only',
          '',
          'On iOS this is what puts the code above the keyboard; on Android it feeds the SMS Retriever. Repeating it on every box makes Safari offer the whole code to each in turn, which is worse than not having it.',
          '',
          '### It is not a password',
          '',
          'The boxes are `type="text"`, unmasked. A one-time code is not a secret worth hiding from the person entering it: masking only stops them checking what they typed against the message they are reading it from. `masked` exists for a stored PIN, which is a different thing and usually wants `PasswordField` instead.',
          '',
          'Nothing here validates. Rate limiting, attempt counting and constant-time comparison are server concerns, and a component that implied otherwise would be a component someone trusted.',
          '',
          '### Accessibility',
          '',
          'Boxes are a visual convention; a screen reader hears one field. The group is labelled, each box announces its position, and the number of characters entered goes through a live region: otherwise there is no way to check progress without deleting everything and starting again.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: { control: false, table: { type: { summary: 'string' }, category: 'State' } },
    onChange: {
      control: false,
      table: { type: { summary: '(value: string) => void' }, category: 'State' },
    },
    onComplete: {
      description:
        'Fires once the last box is filled. Submit from here, never from a timer, which fires on a half-entered code.',
      control: false,
      table: { type: { summary: '(value: string) => void' }, category: 'State' },
    },
    length: {
      control: { type: 'range', min: 4, max: 8, step: 1 },
      table: { type: { summary: 'number' }, defaultValue: { summary: '6' }, category: 'Shape' },
    },
    type: {
      description: '`numeric` gives the phone keypad; `alphanumeric` allows letters.',
      control: 'inline-radio',
      options: ['numeric', 'alphanumeric'],
      table: {
        type: { summary: "'numeric' | 'alphanumeric'" },
        defaultValue: { summary: 'numeric' },
        category: 'Shape',
      },
    },
    groupAfter: {
      description: 'A separator after this many boxes, for a code that is read in groups.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Shape' },
    },
    masked: {
      description:
        'For a stored PIN, not a one-time code. Masking a code the user is reading off a screen only stops them checking it.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Security',
      },
    },
    label: { control: 'text', table: { type: { summary: 'string' }, category: 'Accessibility' } },
    hint: { control: 'text', table: { type: { summary: 'ReactNode' }, category: 'Content' } },
    size: {
      control: 'inline-radio',
      options: ['md', 'lg'],
      table: {
        type: { summary: "'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    disabled: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    invalid: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    autoFocus: {
      description:
        'Focuses the first box on mount. Only correct when the code is the *only* thing on the screen.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Behaviour',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Verification code',
    hint: 'Sent to the number ending 4471.',
    length: 6,
    type: 'numeric',
    size: 'md',
    disabled: false,
    invalid: false,
    value: '',
    onChange: () => undefined,
  },
} satisfies Meta<typeof PinInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [value, setValue] = useState('');
    return (
      <div className="space-y-3">
        <PinInput {...args} value={value} onChange={setValue} />
        <p aria-live="polite" className="font-mono text-xs text-fg-muted">
          value = &quot;{value}&quot;
        </p>
      </div>
    );
  },
};

export const Paste: Story = {
  name: 'Pasting a code',
  parameters: {
    docs: {
      description: {
        story:
          'Copy the code below and paste it into any box, it distributes across the rest and lands focus at the end. This is the behaviour that separates a usable one-time-code field from one that people retype by hand under a timer.',
      },
    },
  },
  render: function PasteStory(args) {
    const [value, setValue] = useState('');
    return (
      <div className="max-w-md space-y-3">
        <Alert tone="info" title="Copy this, then paste it into the first box">
          <span className="flex items-center gap-2">
            <code className="font-mono text-md tracking-widest select-all">481502</code>
            <CopyButton value="481502" label="Copy the demo code" />
          </span>
        </Alert>
        <PinInput {...args} value={value} onChange={setValue} />
      </div>
    );
  },
};

export const Verification: Story = {
  name: 'A verification screen',
  parameters: {
    docs: {
      description: {
        story:
          'The whole flow. `onComplete` submits, never a timer, which fires on a half-entered code, and the failed state clears the boxes and returns focus, because leaving a wrong code in place makes the next attempt a deletion exercise.',
      },
    },
  },
  render: function VerificationStory(args) {
    const [value, setValue] = useState('');
    const [state, setState] = useState<'idle' | 'checking' | 'failed' | 'done'>('idle');

    const submit = (code: string): void => {
      setState('checking');
      setTimeout(() => {
        if (code === '481502') {
          setState('done');
          return;
        }
        setState('failed');
        setValue('');
      }, 700);
    };

    return (
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Confirm it is you</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-fg-muted">
            We sent a code to the number ending 4471. The code for this demo is{' '}
            <code className="font-mono select-all">481502</code>
            <CopyButton value="481502" label="Copy the demo code" className="ms-1 align-middle" />.
          </p>

          <PinInput
            {...args}
            hint=""
            value={value}
            invalid={state === 'failed'}
            disabled={state === 'checking' || state === 'done'}
            onChange={(next) => {
              setValue(next);
              if (state === 'failed') setState('idle');
            }}
            onComplete={submit}
          />

          {state === 'failed' ? (
            <p role="alert" className="text-xs font-medium text-danger-fg">
              That code is not right. Check the message and try again.
            </p>
          ) : null}
          {state === 'done' ? (
            <Alert tone="success" title="Verified">
              You can close this window.
            </Alert>
          ) : null}

          <Button variant="ghost" size="sm" disabled={state === 'checking'}>
            Send a new code
          </Button>
        </CardContent>
      </Card>
    );
  },
};

export const Shapes: Story = {
  name: 'Lengths, groups and letters',
  parameters: {
    docs: {
      description: {
        story:
          'Grouping matters when the code is read aloud or off a screen. `481 502` is two chunks to hold in memory rather than six digits. Alphanumeric codes are upper-cased as they are typed, because a backup code printed in capitals is one that gets typed in capitals.',
      },
    },
  },
  render: function ShapeStory(args) {
    const [four, setFour] = useState('');
    const [grouped, setGrouped] = useState('');
    const [alpha, setAlpha] = useState('');

    return (
      <div className="space-y-6">
        <PinInput
          {...args}
          label="Four digits"
          hint="A door code, a short PIN."
          length={4}
          value={four}
          onChange={setFour}
        />
        <PinInput
          {...args}
          label="Grouped"
          hint="Read in two chunks rather than six digits."
          length={6}
          groupAfter={3}
          value={grouped}
          onChange={setGrouped}
        />
        <PinInput
          {...args}
          label="Backup code"
          hint="Letters and digits. Case is normalised."
          type="alphanumeric"
          length={8}
          groupAfter={4}
          size="lg"
          value={alpha}
          onChange={setAlpha}
        />
      </div>
    );
  },
};

export const MaskedPin: Story = {
  name: 'A stored PIN',
  args: {
    masked: true,
    length: 4,
    label: 'Payroll approval PIN',
    hint: 'Four digits, set by you.',
  },
  parameters: {
    docs: {
      description: {
        story:
          'The only case for `masked`. A stored PIN is a secret and someone may be standing behind you; a one-time code you are copying off your own phone is not. If the value has any length or complexity to it, this should be a `PasswordField`: masked boxes stop being usable past about six characters.',
      },
    },
  },
  render: function MaskedStory(args) {
    const [value, setValue] = useState('');
    return <PinInput {...args} value={value} onChange={setValue} />;
  },
};
