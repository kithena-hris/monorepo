import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { CopyButton } from '../clipboard/clipboard';
import { Alert } from '../feedback/feedback';
import { TagsInput, isEmailish } from './tags-input';

const meta = {
  title: 'Forms/TagsInput',
  component: TagsInput,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Several short values in one field: email addresses, skills, cost centres.',
          '',
          '### The interaction contract',
          '',
          'Enter and comma commit. **Backspace on an empty field selects the last tag; a second press removes it**, a single press that deletes is how a mistyped character costs someone the address they typed a minute ago. Arrow keys walk the tags themselves, which is the part most implementations skip and the only way to remove the *third* tag without a mouse.',
          '',
          'Blur commits too. A typed-but-uncommitted value that vanishes on submit is the most annoying bug this control has.',
          '',
          '### Paste splits',
          '',
          'On commas, semicolons, tabs and newlines, so a column out of a spreadsheet or a line out of an email client arrives as tags rather than as one very long tag. A paste with no separators in it behaves like typing, which is what you want when the value itself contains a space.',
          '',
          '### Rejections are reported',
          '',
          'Duplicates and validation failures are said out loud, never silently dropped: a tag that does not appear is indistinguishable from a broken field. `validate` returns a string, so "not a work address" can be said in those words.',
          '',
          '### Security',
          '',
          'Tags render as text through React, so markup in a value is escaped rather than interpreted: try pasting `<img src=x onerror=alert(1)>`. What this component **cannot** do is protect the next boundary: a tag that becomes a query parameter, a filename or a CSV cell still needs encoding there. It escapes what it displays; it cannot escape what you do with it.',
          '',
          '`autoComplete="off"` is deliberate: browser autofill offering a saved value here fills one tag with an entire form\'s worth of text.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: { control: false, table: { type: { summary: 'readonly string[]' }, category: 'State' } },
    onChange: {
      control: false,
      table: { type: { summary: '(value: readonly string[]) => void' }, category: 'State' },
    },
    label: { control: 'text', table: { type: { summary: 'string' }, category: 'Accessibility' } },
    hint: { control: 'text', table: { type: { summary: 'ReactNode' }, category: 'Content' } },
    placeholder: {
      description: 'Shown only while the list is empty, a placeholder beside six tags is noise.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Type and press Enter' },
        category: 'Content',
      },
    },
    max: {
      description:
        'Upper bound. The field stops accepting and says so, rather than ignoring input.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Validation' },
    },
    validate: {
      description:
        'Return an error string to reject, `null` to accept. The string is shown and announced.',
      control: false,
      table: { type: { summary: '(value: string) => string | null' }, category: 'Validation' },
    },
    transform: {
      description:
        'Normalises before comparison and storage. Trimming by default; lower-casing for addresses, so `Ada@` and `ada@` are one tag.',
      control: false,
      table: {
        type: { summary: '(value: string) => string' },
        defaultValue: { summary: 'trim' },
        category: 'Validation',
      },
    },
    delimiters: {
      description: 'Keys that commit the draft, besides Enter.',
      control: 'object',
      table: {
        type: { summary: 'readonly string[]' },
        defaultValue: { summary: "[',', ';']" },
        category: 'Behaviour',
      },
    },
    size: {
      control: 'inline-radio',
      options: ['sm', 'md'],
      table: {
        type: { summary: "'sm' | 'md'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    disabled: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    invalid: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Skills',
    hint: 'Press Enter or comma after each one.',
    size: 'md',
    disabled: false,
    invalid: false,
    value: [],
    onChange: () => undefined,
  },
} satisfies Meta<typeof TagsInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [value, setValue] = useState<readonly string[]>(['TypeScript', 'PostgreSQL']);
    return (
      <div className="max-w-md">
        <TagsInput {...args} value={value} onChange={setValue} />
      </div>
    );
  },
};

export const Keyboard: Story = {
  name: 'From the keyboard',
  parameters: {
    docs: {
      description: {
        story: [
          'Put the mouse down.',
          '',
          '**Enter** or **comma** commits. **Backspace** on an empty field selects the last tag: press it again to remove. **←** and **→** walk the tags, so the third one can be reached and deleted without a pointer.',
          '',
          'The two-press Backspace is the important detail: one press that deletes turns a stray keystroke into a lost address, and the person who typed it will not notice until the form is submitted.',
        ].join('\n'),
      },
    },
  },
  render: function KeyboardStory(args) {
    const [value, setValue] = useState<readonly string[]>([
      'Payroll',
      'Benefits',
      'Onboarding',
      'Compliance',
    ]);
    return (
      <div className="max-w-md space-y-2">
        <TagsInput {...args} label="Areas of responsibility" value={value} onChange={setValue} />
        <p aria-live="polite" className="font-mono text-xs text-fg-muted">
          [{value.map((tag) => `"${tag}"`).join(', ')}]
        </p>
      </div>
    );
  },
};

export const Validated: Story = {
  name: 'Validation and duplicates',
  parameters: {
    docs: {
      description: {
        story: [
          'Try `not-an-address`, then a personal domain, then the same address twice. Each refusal says what was wrong in words.',
          '',
          'The email check here is a shape check, not a validator. The only way to know an address exists is to send to it, a regex that rejects `user+tag@sub.domain.museum` has broken a valid address to catch a typo it would not have caught anyway.',
        ].join('\n'),
      },
    },
  },
  render: function ValidatedStory(args) {
    const [value, setValue] = useState<readonly string[]>(['grace@acme.example']);
    const addressList = 'ada@acme.example, radia@acme.example; barbara@acme.example';
    return (
      <div className="max-w-md space-y-3">
        <TagsInput
          {...args}
          label="Invite people"
          hint="Work addresses only. Paste a list, it splits on commas and newlines."
          placeholder="name@acme.example"
          max={10}
          // Lower-cased, so `Ada@` and `ada@` are one tag rather than two
          // invitations to the same person.
          transform={(input) => input.trim().toLowerCase()}
          validate={(input) => {
            if (!isEmailish(input)) return `${input} does not look like an email address.`;
            if (!input.endsWith('@acme.example'))
              return 'Only acme.example addresses can be invited.';
            return null;
          }}
          value={value}
          onChange={setValue}
        />
        <Alert tone="info" title="Try pasting this">
          <span className="flex items-start gap-2">
            <code className="min-w-0 flex-1 font-mono text-xs break-all select-all">
              {addressList}
            </code>
            <CopyButton value={addressList} label="Copy the example addresses" />
          </span>
        </Alert>
      </div>
    );
  },
};

export const Escaping: Story = {
  name: 'Markup is escaped',
  parameters: {
    docs: {
      description: {
        story: [
          'Paste `<img src=x onerror=alert(1)>` and press Enter. It becomes a tag containing those characters. React escapes it, so it is displayed and never interpreted.',
          '',
          'What this component **cannot** do is protect the next boundary. That same tag becoming a query parameter, a filename, a CSV cell or an `innerHTML` somewhere else still needs encoding *there*. A component escapes what it renders; it has no idea what you will do with the value afterwards, and a CSV cell beginning `=` is a formula in Excel regardless of how carefully it was displayed here.',
        ].join('\n'),
      },
    },
  },
  render: function EscapingStory(args) {
    const [value, setValue] = useState<readonly string[]>([
      '<b>bold</b>',
      '"; DROP TABLE people;--',
    ]);
    // A classic reflected-XSS payload. It renders as characters here; the
    // point of the story is that this component escaping it says nothing about
    // what happens to the value afterwards.
    const payload = '<img src=x onerror=alert(1)>';

    return (
      <div className="max-w-lg space-y-3">
        <Alert tone="warning" title="Copy this, then paste it into the field">
          <span className="flex items-start gap-2">
            <code className="min-w-0 flex-1 font-mono text-xs break-all select-all">{payload}</code>
            <CopyButton value={payload} label="Copy the example payload" />
          </span>
        </Alert>

        <TagsInput
          {...args}
          label="Try to break it"
          hint="Anything you type is displayed as characters, never as markup."
          value={value}
          onChange={setValue}
        />
        <div className="relative">
          <pre className="overflow-x-auto rounded-md bg-surface-sunken p-3 pe-10 font-mono text-xs text-fg-muted">
            {JSON.stringify(value, null, 2)}
          </pre>
          <div className="absolute top-1.5 end-1.5">
            <CopyButton value={JSON.stringify(value, null, 2)} label="Copy the stored values" />
          </div>
        </div>
      </div>
    );
  },
};

export const Limits: Story = {
  name: 'A limit',
  parameters: {
    docs: {
      description: {
        story:
          'At the limit the field stops accepting and the placeholder says why. A field that silently ignores the eleventh entry looks broken; one that says "Limit reached" is merely full.',
      },
    },
  },
  render: function LimitStory(args) {
    const [value, setValue] = useState<readonly string[]>(['TypeScript', 'Go', 'Postgres']);
    return (
      <div className="max-w-md">
        <TagsInput
          {...args}
          label="Top skills"
          hint="Up to five, in order of strength."
          max={5}
          value={value}
          onChange={setValue}
        />
      </div>
    );
  },
};

export const States: Story = {
  name: 'Sizes and states',
  render: (args) => (
    <div className="grid max-w-3xl gap-4 md:grid-cols-2">
      <TagsInput
        {...args}
        size="sm"
        label="Small"
        hint=""
        value={['Madrid', 'Berlin']}
        onChange={() => undefined}
      />
      <TagsInput
        {...args}
        label="Disabled"
        hint="Set by the job requisition."
        disabled
        value={['Platform', 'Payroll']}
        onChange={() => undefined}
      />
    </div>
  ),
};
