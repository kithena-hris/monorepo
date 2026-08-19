import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Card, CardContent, CardHeader, CardTitle } from '../card/card';
import { Field, FieldControl, FieldDescription, FieldLabel } from '../field/field';
import { Input } from '../input/input';
import { CurrencyField, PhoneField, SearchField } from './typed-fields';

const meta = {
  title: 'Forms/Typed fields',
  component: SearchField,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Every input type an HRIS form needs, set up so it works on the device it is opened on.',
          '',
          '### The type is not enough on its own',
          '',
          '`type="email"` picks the validation rules and nothing else. It does **not** bring up the keyboard with the `@` on it, stop iOS capitalising the first letter, stop autocorrect rewriting the domain, or tell a password manager what to fill. Those are four more attributes. They are the difference between a form that works on a phone and one that fights it, and nobody remembers all four.',
          '',
          'So `Input` derives them from `type`. Anything you pass explicitly still wins. It is a default, not a policy.',
          '',
          '| `type` | `inputMode` | `autoComplete` | `enterKeyHint` | Verbatim entry |',
          '| --- | --- | --- | --- | --- |',
          '| `email` | `email` | `email` | `next` | yes |',
          '| `tel` | `tel` | `tel` | `next` | yes |',
          '| `url` | `url` | `url` | `go` | yes |',
          '| `search` | `search` | — | `search` | yes |',
          '| `number` | `numeric` | — | — | yes |',
          '| `password` | — | `current-password` | — | yes |',
          '| `date` `time` | — | `off` | — | — |',
          '',
          '"Verbatim entry" is `autoCapitalize="none"`, `autoCorrect="off"` and `spellCheck={false}` together, the three that stop a phone helpfully turning `ada@example.com` into `Ada@example.con`.',
          '',
          '### Three types need code, not attributes',
          '',
          'Everything above is a matter of the right attributes. These are not:',
          '',
          '- **`SearchField`**, a search box has to be clearable, and the clear has to be reachable.',
          '- **`CurrencyField`**: money must never touch a float.',
          '- **`PhoneField`**, a phone number is two fields that travel as one string.',
          '',
          '### What to use where',
          '',
          'For a number people *edit* rather than type once, use `NumberField`: `type="number"` scrolls its value when the wheel passes over it, rejects leading zeros, and reports an empty string for anything it cannot parse. For dates use `DatePicker`; for one-time codes `PinInput`; for passwords `PasswordField`.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: { control: 'text', table: { category: 'Data' } },
    onValueChange: { control: false, table: { category: 'Data' } },
    onSearch: { control: false, table: { category: 'Data' } },
    label: { control: 'text', table: { category: 'Content' } },
    hideIcon: { control: 'boolean', table: { category: 'Appearance' } },
    size: {
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: { defaultValue: { summary: "'md'" }, category: 'Appearance' },
    },
  },
  args: {
    value: '',
    label: 'Search people',
    onValueChange: fn().mockName('onValueChange(text)'),
    onSearch: fn().mockName('onSearch(text)'),
  },
} satisfies Meta<typeof SearchField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryType: Story = {
  name: 'Every type',
  parameters: {
    docs: {
      description: {
        story:
          'Open this story on a phone, or in the iPhone viewport with a real device, and tab through. Each field brings up a different keyboard, and none of them capitalises what it should not. The attributes come from the `type` alone; nothing here sets `inputMode` by hand.',
      },
    },
  },
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Personal details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field>
          <FieldLabel>Full name</FieldLabel>
          <FieldControl>
            <Input type="text" autoComplete="name" placeholder="Grace Hopper" />
          </FieldControl>
        </Field>

        <Field>
          <FieldLabel>Work email</FieldLabel>
          <FieldControl>
            <Input type="email" placeholder="grace@example.com" />
          </FieldControl>
          <FieldDescription>
            The keyboard shows an `@`, and nothing capitalises or autocorrects.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Personal website</FieldLabel>
          <FieldControl>
            <Input type="url" placeholder="https://example.com" />
          </FieldControl>
        </Field>

        <Field>
          <FieldLabel>Employee number</FieldLabel>
          <FieldControl>
            <Input type="number" placeholder="004182" />
          </FieldControl>
          <FieldDescription>
            A number typed once. For one that gets adjusted, use `NumberField`.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Start date</FieldLabel>
          <FieldControl>
            <Input type="date" />
          </FieldControl>
        </Field>
      </CardContent>
    </Card>
  ),
};

export const Search: Story = {
  name: 'Search',
  parameters: {
    docs: {
      description: {
        story: [
          '`type="search"` gives you the semantics and, in WebKit, a clear button **no keyboard can reach and no screen reader announces**. This renders its own: a real `<button>` with a name.',
          '',
          'It appears only when there is something to clear, a permanent clear button on an empty field is a control that does nothing, and people press it to find out. Escape clears too, which is what every search field on the platform does.',
          '',
          'Focus returns to the input after clearing. Leaving focus on a button that has just removed itself sends it to `<body>`, and the next Tab starts from the top of the page.',
        ].join('\n'),
      },
    },
  },
  render: function SearchStory(args) {
    const [value, setValue] = useState('Hopper');

    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <SearchField
            {...args}
            value={value}
            onValueChange={(next) => {
              setValue(next);
              args.onValueChange(next);
            }}
            {...(args.onSearch ? { onSearch: args.onSearch } : {})}
            placeholder="Name, team or email"
          />
        </CardContent>
      </Card>
    );
  },
};

export const Currency: Story = {
  name: 'Money',
  parameters: {
    docs: {
      description: {
        story: [
          'The field shows major units because that is what people type; the value it reports is **minor units as a string**, because that is what gets stored.',
          '',
          'The conversion is string arithmetic in both directions. `0.1 + 0.2` is `0.30000000000000004`, and a payroll system that rounds a cent the wrong way once a fortnight for four thousand people has an audit finding, not a bug. `decimal.js` in application code, `numeric(19,4)` in Postgres, minor units in transport. This is the input end of the same rule.',
          '',
          '`inputMode="decimal"` on a text input rather than `type="number"`: a number input rejects the grouping separators people paste in, and its spinner turns a salary into a scroll target.',
          '',
          'Type into it and watch the reported value. The displayed text is left exactly as typed while the field has focus: reformatting mid-entry moves the caret, and a caret that jumps as you type a salary is how people enter it twice.',
        ].join('\n'),
      },
    },
  },
  render: function CurrencyStory() {
    const [minor, setMinor] = useState('142000');
    const log = fn().mockName('onValueChange(minorUnits)');

    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Compensation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel>Base salary</FieldLabel>
            <FieldControl>
              <CurrencyField
                currency="EUR"
                value={minor}
                onValueChange={(next) => {
                  setMinor(next);
                  log(next);
                }}
              />
            </FieldControl>
            <FieldDescription>Paid monthly.</FieldDescription>
          </Field>
          <p className="text-sm text-fg-muted">
            Reported value: <code className="tabular-nums">{minor || '(empty)'}</code> minor units
          </p>
        </CardContent>
      </Card>
    );
  },
};

export const Phone: Story = {
  name: 'Phone number',
  parameters: {
    docs: {
      description: {
        story: [
          'A dial code and a national number that travel as one string.',
          '',
          'The dial code is a **native `<select>`**, deliberately. On a phone it opens the platform picker, which is scrollable with a thumb, searchable by keyboard on a desktop, and translated by the OS. A custom listbox of two hundred countries is a worse version of a control every device already ships.',
          '',
          '**It does not validate.** Numbering plans differ by country and change; a regex that "validates" a phone number rejects real ones. `inputMode="tel"` gets the right keypad, the field accepts what people type, and anything stricter belongs on the server with a library that tracks the plans.',
        ].join('\n'),
      },
    },
  },
  render: function PhoneStory() {
    const [value, setValue] = useState('+44 7700 900123');
    const log = fn().mockName('onValueChange(e164ish)');

    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Contact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel>Mobile</FieldLabel>
            <FieldControl>
              <PhoneField
                value={value}
                onValueChange={(next) => {
                  setValue(next);
                  log(next);
                }}
                onDialCodeChange={fn().mockName('onDialCodeChange(code)')}
              />
            </FieldControl>
          </Field>
          <p className="text-sm text-fg-muted">
            Reported value: <code>{value}</code>
          </p>
        </CardContent>
      </Card>
    );
  },
};

export const OnAPhone: Story = {
  name: 'On a phone',
  globals: { viewport: { value: 'iphone15', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'The same fields at 393px. Every control is at least 44px tall because `@media (pointer: coarse)` re-points the density tokens, the dial-code select, the clear button and the inputs all grow without a breakpoint being written. The one thing that does not change is the attributes: they were already right.',
      },
    },
  },
  render: function PhoneViewStory() {
    const [search, setSearch] = useState('');
    const [minor, setMinor] = useState('89000');
    const [phone, setPhone] = useState('+49 151 23456789');

    return (
      <Card>
        <CardHeader>
          <CardTitle>New starter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SearchField value={search} onValueChange={setSearch} label="Search people" />
          <Field>
            <FieldLabel>Work email</FieldLabel>
            <FieldControl>
              <Input type="email" placeholder="grace@example.com" />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>Mobile</FieldLabel>
            <FieldControl>
              <PhoneField value={phone} onValueChange={setPhone} />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>Base salary</FieldLabel>
            <FieldControl>
              <CurrencyField currency="EUR" value={minor} onValueChange={setMinor} />
            </FieldControl>
          </Field>
        </CardContent>
      </Card>
    );
  },
};
