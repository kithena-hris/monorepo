import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Alert } from '../feedback/feedback';
import { NumberField } from './number-field';

const meta = {
  title: 'Forms/NumberField',
  component: NumberField,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'A number, with steppers.',
          '',
          '### Why not `<input type="number">`',
          '',
          'It is one of the least reliable controls on the platform:',
          '',
          '- **A scroll wheel over a focused field silently changes the value.** On a long form that is a corrupted record nobody noticed. This blurs on wheel, which closes it.',
          '- **`""` means two different things.** Browsers return an empty string both for an empty field and for `1e`, so "the user cleared it" and "the user typed nonsense" are indistinguishable. Here the value is `number | null`.',
          '- **Locale is ignored.** A German user typing `1,5` gets nothing. This accepts both separators.',
          '- **The spinner cannot be styled** and vanishes entirely on a phone.',
          '',
          'So: a text input with `inputMode`, parsed here. The phone keyboard is still numeric, the arrow keys still step, and `role="spinbutton"` keeps the announcement: bounds included, that `type="number"` would have given.',
          '',
          '### Clamping happens on blur',
          '',
          'Clamping per keystroke makes `10` unreachable in a field with a minimum of 5: the `1` is corrected to 5 before the `0` arrives. The value is constrained when the field is left.',
          '',
          '### Not for money',
          '',
          'A currency amount is minor units and a `Money` component. A float that has been through a stepper is a float that has been rounded, and payroll is not a rounding-tolerant domain.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    value: {
      description:
        '`null` is empty, which is a different fact from `0`, and zero is a legitimate salary component.',
      control: { type: 'number' },
      table: { type: { summary: 'number | null' }, category: 'State' },
    },
    onChange: {
      description:
        'Fires on every keystroke with the parsed value, unclamped. Clamping is on blur.',
      control: false,
      table: { type: { summary: '(value: number | null) => void' }, category: 'State' },
    },
    label: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
    hint: {
      description: 'Help text, wired through `aria-describedby`.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    min: {
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Range' },
    },
    max: {
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Range' },
    },
    step: {
      description: 'Arrow-key and stepper increment. Shift multiplies it by ten.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, defaultValue: { summary: '1' }, category: 'Range' },
    },
    precision: {
      description: 'Decimal places. `0` also switches the phone keyboard to the integer pad.',
      control: { type: 'number' },
      table: { type: { summary: 'number' }, category: 'Range' },
    },
    prefix: {
      description: 'Inside the field, before the number.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    suffix: {
      description: 'A unit: days, hours, %.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    size: {
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    hideSteppers: {
      description: 'Hides the +/− buttons. Arrow keys still step.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Appearance',
      },
    },
    disabled: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    readOnly: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    invalid: { control: 'boolean', table: { type: { summary: 'boolean' }, category: 'State' } },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    label: 'Notice period',
    hint: 'Calendar days. The statutory minimum in Spain is 15.',
    min: 0,
    max: 90,
    step: 5,
    suffix: 'days',
    size: 'md',
    value: 30,
    onChange: () => undefined,
  },
} satisfies Meta<typeof NumberField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [value, setValue] = useState<number | null>(30);
    return (
      <div className="max-w-xs">
        <NumberField {...args} value={value} onChange={setValue} />
      </div>
    );
  },
};

export const NullIsNotZero: Story = {
  name: 'Null is not zero',
  parameters: {
    docs: {
      description: {
        story:
          'Clear the field and watch the readout. `null` means *nobody has said*, `0` means *someone said none*. In an HRIS that is the difference between "we have not asked about overtime" and "this contract has no overtime", and a component that returns `0` for an empty field makes the second one unsayable.',
      },
    },
  },
  render: function NullStory(args) {
    const [value, setValue] = useState<number | null>(null);
    return (
      <div className="max-w-xs space-y-3">
        <NumberField
          {...args}
          label="Contracted overtime"
          hint="Leave empty if the contract does not mention it."
          suffix="hours"
          min={0}
          max={20}
          step={1}
          value={value}
          onChange={setValue}
        />
        <p aria-live="polite" className="font-mono text-xs text-fg-muted">
          value = {value === null ? 'null' : String(value)}
        </p>
      </div>
    );
  },
};

export const Precision: Story = {
  name: 'Decimals and locale',
  parameters: {
    docs: {
      description: {
        story:
          'Type `1,5` in the second field. It parses: half of Europe types a comma, and a field that silently rejects it looks broken rather than strict. The stepper also rounds against floating point, which is otherwise where `0.1 + 0.2` shows up in front of a user.',
      },
    },
  },
  render: function PrecisionStory(args) {
    const [days, setDays] = useState<number | null>(2.5);
    const [rate, setRate] = useState<number | null>(1.5);

    return (
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <NumberField
          {...args}
          label="Leave taken"
          hint="Half days allowed."
          suffix="days"
          min={0}
          max={30}
          step={0.5}
          precision={1}
          value={days}
          onChange={setDays}
        />
        <NumberField
          {...args}
          label="Overtime multiplier"
          hint="Try typing 1,75 with a comma."
          suffix="×"
          min={1}
          max={3}
          step={0.25}
          precision={2}
          value={rate}
          onChange={setRate}
        />
      </div>
    );
  },
};

export const Affixes: Story = {
  name: 'Prefixes, suffixes and sizes',
  parameters: {
    docs: {
      description: {
        story:
          'The unit belongs **in** the field, not in the label, "30" and "30 days" are read differently, and a label the user has already scrolled past cannot supply it. Currency is shown here for completeness; a real amount belongs in `Money` and minor units.',
      },
    },
  },
  render: function AffixStory(args) {
    const [values, setValues] = useState<Record<string, number | null>>({
      days: 25,
      percent: 15,
      headcount: 912,
    });
    const set = (key: string) => (value: number | null) => {
      setValues((current) => ({ ...current, [key]: value }));
    };

    return (
      <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
        <NumberField
          {...args}
          size="sm"
          label="Entitlement"
          hint=""
          suffix="days"
          min={0}
          max={40}
          step={1}
          value={values['days'] ?? null}
          onChange={set('days')}
        />
        <NumberField
          {...args}
          size="md"
          label="Bonus target"
          hint=""
          suffix="%"
          min={0}
          max={100}
          step={5}
          value={values['percent'] ?? null}
          onChange={set('percent')}
        />
        <NumberField
          {...args}
          size="lg"
          label="Headcount cap"
          hint=""
          min={0}
          step={10}
          precision={0}
          hideSteppers
          value={values['headcount'] ?? null}
          onChange={set('headcount')}
        />
      </div>
    );
  },
};

export const Bounds: Story = {
  name: 'Bounds and validation',
  parameters: {
    docs: {
      description: {
        story:
          'Type `200` in a field capped at 90 and tab away: it clamps on blur, not per keystroke: otherwise `10` would be unreachable in a field with a minimum of 5. The message is a message, not a red border alone.',
      },
    },
  },
  render: function BoundsStory(args) {
    const [value, setValue] = useState<number | null>(120);
    const tooHigh = value !== null && value > 90;

    return (
      <div className="max-w-xs space-y-2">
        <NumberField
          {...args}
          value={value}
          onChange={setValue}
          invalid={tooHigh}
          hint="Clamped to 90 when you leave the field."
        />
        {tooHigh ? (
          <Alert tone="warning" title="Above the statutory maximum">
            90 days is the longest notice period this entity can set.
          </Alert>
        ) : null}
      </div>
    );
  },
};

export const States: Story = {
  name: 'Disabled and read-only',
  parameters: {
    docs: {
      description: {
        story:
          'Read-only keeps the value selectable and copyable; disabled does not. "You may not change this" and "this does not apply" are different facts, and the reason belongs beside the field either way.',
      },
    },
  },
  render: (args) => (
    <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <NumberField
        {...args}
        label="Statutory minimum"
        hint="Set by Spanish labour law."
        readOnly
        value={15}
        onChange={() => undefined}
      />
      <NumberField
        {...args}
        label="Overtime cap"
        hint="Not applicable to salaried contracts."
        disabled
        value={null}
        onChange={() => undefined}
      />
    </div>
  ),
};
