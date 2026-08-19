import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../button/button';
import type { IsoDate } from '../calendar/calendar';
import { Checkbox } from '../checkbox/checkbox';
import { DatePicker } from '../date-picker/date-picker';
import { Input, Textarea } from '../input/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select/select';
import { Switch } from '../switch/switch';
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from './field';

const meta = {
  title: 'Forms/Field',
  component: Field,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Form field wiring, the part everyone means to do by hand and half the time does not.',
          '',
          'The label, the help text and the error are associated with the control by generated id. A form written this way cannot end up with three of its nine fields correctly labelled.',
          '',
          '### The parts',
          '',
          '| Part | Does |',
          '| --- | --- |',
          '| `Field` | Generates the ids, owns `invalid` / `required` / `disabled`. |',
          '| `FieldLabel` | `<label for>` pointing at the control, plus a real required marker. |',
          '| `FieldControl` | Injects `id`, `aria-describedby`, `aria-invalid`, `aria-required` onto whatever it wraps. |',
          '| `FieldDescription` | Persistent help text, always in the accessible description. |',
          '| `FieldError` | Renders only while `invalid`, announced politely. |',
          '',
          '### Notes',
          '',
          '- `FieldControl` wraps the element that renders a DOM node. For `Select`. That is `SelectTrigger`, not the root.',
          '- The required marker is a real `*` plus an `(required)` announcement: colour alone cannot carry state.',
          '- The error is `aria-live="polite"`: an assertive message that fires on every keystroke is worse than none.',
          '- Validation messages come from the same Zod schema the API validates against. One definition, two enforcement points; this layer only renders the verdict.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    invalid: {
      description: 'Marks the control invalid and reveals `FieldError`.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    required: {
      description: 'Adds the marker, sets `aria-required`, and announces "(required)".',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    disabled: {
      description: 'Dims the label and forwards `disabled` to the wrapped control.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    orientation: {
      description:
        'Label above the control, or beside it. Use `horizontal` for switches and single checkboxes.',
      control: 'inline-radio',
      options: ['vertical', 'horizontal'],
      table: {
        type: { summary: "'vertical' | 'horizontal'" },
        defaultValue: { summary: 'vertical' },
        category: 'Layout',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { invalid: false, required: false, disabled: false, orientation: 'vertical' },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { required: true },
  parameters: {
    docs: {
      description: {
        story:
          'Toggle `invalid` to see the error appear and `aria-describedby` grow to name both the description and the message.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-sm">
      <Field {...args}>
        <FieldLabel>Work email</FieldLabel>
        <FieldControl>
          <Input defaultValue="ada@" />
        </FieldControl>
        <FieldDescription>Used for the account invitation.</FieldDescription>
        <FieldError>Enter a complete email address.</FieldError>
      </Field>
    </div>
  ),
};

export const Text: Story = {
  args: { required: true },
  parameters: {
    docs: {
      description: {
        story:
          'The baseline: label, control, persistent help text. The help text stays visible: moving it into a tooltip hides it from touch users entirely.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-sm">
      <Field {...args}>
        <FieldLabel>Legal first name</FieldLabel>
        <FieldControl>
          <Input placeholder="Ada" />
        </FieldControl>
        <FieldDescription>As it appears on the employment contract.</FieldDescription>
      </Field>
    </div>
  ),
};

export const Invalid: Story = {
  args: { required: true, invalid: true },
  parameters: {
    docs: {
      description: {
        story:
          'The message says what to do, not that something is wrong. "Enter a complete email address" beats "Invalid input", which the user could already see.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-sm">
      <Field {...args}>
        <FieldLabel>Work email</FieldLabel>
        <FieldControl>
          <Input defaultValue="ada@" />
        </FieldControl>
        <FieldDescription>Used for the account invitation.</FieldDescription>
        <FieldError>Enter a complete email address.</FieldError>
      </Field>
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
  parameters: {
    docs: {
      description: {
        story:
          '`disabled` on the `Field` reaches the control through `FieldControl`, so the label and the input cannot disagree about the state.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-sm">
      <Field {...args}>
        <FieldLabel>Employee number</FieldLabel>
        <FieldControl>
          <Input defaultValue="EMP-004182" />
        </FieldControl>
        <FieldDescription>Assigned on hire and never reused.</FieldDescription>
      </Field>
    </div>
  ),
};

export const Adornments: Story = {
  render: () => (
    <div className="grid max-w-sm gap-4">
      <Field>
        <FieldLabel>Search the directory</FieldLabel>
        <FieldControl>
          <Input startAdornment={<Search />} placeholder="Name, team or location" />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>Effective from</FieldLabel>
        {/* The system's picker, not `type="date"`: the native control is a
            different widget in every browser, and this one keeps the value an
            ISO string all the way to the `date` column. */}
        <FieldControl>
          <DatePicker
            mode="single"
            label="Effective from"
            today="2026-08-10"
            value="2026-09-01"
            onChange={() => undefined}
          />
        </FieldControl>
        <FieldDescription>
          When the change takes effect in the domain, which is not when it was recorded.
        </FieldDescription>
      </Field>
    </div>
  ),
};

export const Horizontal: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A switch commits the moment it moves, so it sits beside its label with no Save button in sight. If the setting needs saving. It is a checkbox.',
      },
    },
  },
  render: () => (
    <div className="max-w-md">
      <Field orientation="horizontal">
        <div>
          <FieldLabel>Notify the approval chain</FieldLabel>
          <FieldDescription>Sends an email the moment the request is filed.</FieldDescription>
        </div>
        <FieldControl>
          <Switch defaultChecked />
        </FieldControl>
      </Field>
    </div>
  ),
};

export const CompleteForm: Story = {
  name: 'A whole form',
  parameters: {
    docs: {
      description: {
        story: [
          'Every control here comes from the system, including the dates.',
          '',
          'A native `<input type="date">` would have been shorter to write and wrong in three ways that matter to this product: it cannot mark a day (a public holiday, a colleague already away), it renders a different picker in every browser, so the same screen is a wheel on iOS, a grid on Chrome and a text box on Firefox, and it gives no way to express a *range* as one decision. `DatePicker` does all three, and keeps the value an ISO string all the way to the `date` column.',
          '',
          'The exception is worth stating: on a phone, for one unconstrained date with nothing to mark, the native input is genuinely better: iOS gives it a wheel that beats any grid, for free. That is a per-field call, not a system-wide one.',
        ].join('\n'),
      },
    },
  },
  render: function CompleteFormStory() {
    const today: IsoDate = '2026-08-10';
    const [start, setStart] = useState<IsoDate | null>('2026-09-14');
    const [end, setEnd] = useState<IsoDate | null>('2026-09-10');
    const invalidRange = typeof start === 'string' && typeof end === 'string' && end < start;

    return (
      <form
        className="grid max-w-md gap-5"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <Field required>
          <FieldLabel>Leave type</FieldLabel>
          {/* `FieldControl` wraps the trigger, not the root: the root renders no
            DOM node, so there is nothing there to carry the id or the ARIA. */}
          <Select defaultValue="annual">
            <FieldControl>
              <SelectTrigger>
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              <SelectItem value="annual">Annual leave</SelectItem>
              <SelectItem value="sick">Sick leave</SelectItem>
              <SelectItem value="parental">Parental leave</SelectItem>
              <SelectItem value="unpaid">Unpaid leave</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field required>
            <FieldLabel>First day</FieldLabel>
            {/* The picker is labelled by the `Field`, so its own `label` prop is
              the accessible name of the popover rather than a second visible
              one. */}
            <FieldControl>
              <DatePicker
                mode="single"
                label="First day of leave"
                today={today}
                min={today}
                value={start}
                onChange={(next) => {
                  setStart(next);
                }}
                markers={{
                  '2026-09-15': { tone: 'danger' },
                  '2026-09-21': { tone: 'warning' },
                  '2026-09-22': { tone: 'warning' },
                }}
              />
            </FieldControl>
            <FieldDescription>
              Red is a public holiday; amber is a teammate already away, neither is expressible in a
              native date input.
            </FieldDescription>
          </Field>

          <Field required invalid={invalidRange}>
            <FieldLabel>Last day</FieldLabel>
            <FieldControl>
              <DatePicker
                mode="single"
                label="Last day of leave"
                today={today}
                min={typeof start === 'string' ? start : today}
                value={end}
                onChange={(next) => {
                  setEnd(next);
                }}
              />
            </FieldControl>
            <FieldError>The last day cannot precede the first.</FieldError>
          </Field>
        </div>

        <Field>
          <FieldLabel>Note for your manager</FieldLabel>
          <FieldControl>
            <Textarea autoResize placeholder="Optional" />
          </FieldControl>
        </Field>

        <Field orientation="horizontal">
          <FieldLabel>Deduct from this year&rsquo;s balance</FieldLabel>
          <FieldControl>
            <Checkbox defaultChecked />
          </FieldControl>
        </Field>

        <div className="flex justify-end gap-2">
          <Button variant="ghost">Cancel</Button>
          <Button variant="primary" type="submit" disabled={invalidRange}>
            File request
          </Button>
        </div>
      </form>
    );
  },
};
