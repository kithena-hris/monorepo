import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Field, FieldControl, FieldError, FieldLabel } from '../field/field';
import { Switch } from '../switch/switch';
import { Checkbox } from './checkbox';

const meta = {
  title: 'Forms/Checkbox',
  component: Checkbox,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          '**A checkbox selects. A switch commits.**',
          '',
          'If the setting needs a Save button. It is a checkbox. If it takes effect the moment it moves. It is a switch. Getting this backwards is how a user walks away believing a preference was saved when it never was, and in an HRIS that preference might be "notify the approval chain".',
          '',
          '- Three real states: `true`, `false`, `"indeterminate"`. The last reports `aria-checked="mixed"`, which is what a select-all over a partial selection actually means.',
          '- Always inside a `Field`, so the label is clickable and the hit target is bigger than 16px.',
          '',
          'The `Switch` page covers the other half of that rule, including what a failed write should look like.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    checked: {
      description: 'Controlled state. `"indeterminate"` is a real value, not a styling flag.',
      control: 'inline-radio',
      options: [true, false, 'indeterminate'],
      table: { type: { summary: "boolean | 'indeterminate'" }, category: 'Value' },
    },
    defaultChecked: {
      description: 'Uncontrolled starting state.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'Value' },
    },
    disabled: {
      description: 'Unavailable. Say why nearby; a disabled checkbox explains nothing on its own.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    required: {
      description: 'Native form semantics, for consent boxes that genuinely block submission.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    name: {
      description: 'Form field name for the hidden input the primitive renders.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Form' },
    },
    value: {
      description: 'Submitted value when checked.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Form' },
    },
    onCheckedChange: { action: 'checked changed', table: { category: 'Events' } },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: { disabled: false },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { defaultChecked: true },
  render: (args) => (
    <Field orientation="horizontal" className="max-w-xs">
      <FieldLabel>Deduct from this year&rsquo;s balance</FieldLabel>
      <FieldControl>
        <Checkbox {...args} />
      </FieldControl>
    </Field>
  ),
};

export const CheckboxStates: Story = {
  name: 'Checkbox states',
  parameters: {
    docs: {
      description: {
        story:
          'Unchecked, checked, mixed, disabled and invalid. Every one reads differently without relying on colour alone.',
      },
    },
  },
  render: () => (
    <div className="grid max-w-xs gap-3">
      <Field orientation="horizontal">
        <FieldLabel>Unchecked</FieldLabel>
        <FieldControl>
          <Checkbox />
        </FieldControl>
      </Field>
      <Field orientation="horizontal">
        <FieldLabel>Checked</FieldLabel>
        <FieldControl>
          <Checkbox defaultChecked />
        </FieldControl>
      </Field>
      <Field orientation="horizontal">
        <FieldLabel>Indeterminate</FieldLabel>
        <FieldControl>
          <Checkbox checked="indeterminate" />
        </FieldControl>
      </Field>
      <Field orientation="horizontal" disabled>
        <FieldLabel>Disabled</FieldLabel>
        <FieldControl>
          <Checkbox disabled defaultChecked />
        </FieldControl>
      </Field>
      <Field orientation="horizontal" invalid required>
        <FieldLabel>Required consent</FieldLabel>
        <FieldControl>
          <Checkbox />
        </FieldControl>
        <FieldError>You must accept the policy to continue.</FieldError>
      </Field>
    </div>
  ),
};

export const Indeterminate: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A working select-all. The header reports `mixed` while the selection is partial, which is the only honest answer to "is this checked?".',
      },
    },
  },
  render: function IndeterminateStory() {
    const names = ['Ada Lovelace', 'Grace Hopper', 'Radia Perlman'];
    const [selected, setSelected] = useState<string[]>(['Ada Lovelace']);
    const all = selected.length === names.length;
    const some = selected.length > 0 && !all;

    return (
      <div className="grid max-w-xs gap-2">
        <Field orientation="horizontal">
          <FieldLabel>Select all</FieldLabel>
          <FieldControl>
            <Checkbox
              checked={all ? true : some ? 'indeterminate' : false}
              onCheckedChange={(next) => {
                setSelected(next === true ? names : []);
              }}
            />
          </FieldControl>
        </Field>
        <div className="grid gap-2 border-t border-border pt-2 pl-4">
          {names.map((name) => (
            <Field key={name} orientation="horizontal">
              <FieldLabel>{name}</FieldLabel>
              <FieldControl>
                <Checkbox
                  checked={selected.includes(name)}
                  onCheckedChange={(next) => {
                    setSelected((current) =>
                      next === true ? [...current, name] : current.filter((n) => n !== name),
                    );
                  }}
                />
              </FieldControl>
            </Field>
          ))}
        </div>
        <p className="font-mono text-2xs text-fg-muted">
          {selected.length} of {names.length} selected
        </p>
      </div>
    );
  },
};

export const CheckboxOrSwitch: Story = {
  name: 'Checkbox or switch?',
  parameters: {
    docs: {
      description: {
        story:
          'The same setting, twice. On the left it is staged and saved; on the right it is already written. Only one of these two forms is honest for any given setting.',
      },
    },
  },
  render: () => (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="rounded-lg border border-border p-4">
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
          Staged: checkbox
        </p>
        <div className="mt-3">
          <Field orientation="horizontal">
            <FieldLabel>Notify the approval chain</FieldLabel>
            <FieldControl>
              <Checkbox defaultChecked />
            </FieldControl>
          </Field>
        </div>
        <p className="mt-3 text-xs text-fg-muted">Applies when the form is submitted.</p>
      </div>
      <div className="rounded-lg border border-border p-4">
        <p className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
          Immediate: switch
        </p>
        <div className="mt-3">
          <Field orientation="horizontal">
            <FieldLabel>Notify the approval chain</FieldLabel>
            <FieldControl>
              <Switch defaultChecked />
            </FieldControl>
          </Field>
        </div>
        <p className="mt-3 text-xs text-fg-muted">Written the moment it moves.</p>
      </div>
    </div>
  ),
};
