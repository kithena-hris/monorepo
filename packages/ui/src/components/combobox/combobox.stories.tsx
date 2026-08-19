import type { Meta, StoryObj } from '@storybook/react-vite';
import { Building2, MapPin } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Combobox, type ComboboxOption } from './combobox';

const people: ComboboxOption[] = [
  {
    value: 'ghopper',
    label: 'Grace Hopper',
    description: 'Principal Engineer · Platform',
    group: 'Engineering',
  },
  {
    value: 'alovelace',
    label: 'Ada Lovelace',
    description: 'Staff Engineer · Platform',
    group: 'Engineering',
  },
  {
    value: 'bliskov',
    label: 'Barbara Liskov',
    description: 'Distinguished Engineer · Platform',
    group: 'Engineering',
  },
  {
    value: 'rperlman',
    label: 'Radia Perlman',
    description: 'Engineering Manager · Payroll',
    group: 'Engineering',
  },
  {
    value: 'kjohnson',
    label: 'Katherine Johnson',
    description: 'Data Analyst · People Ops',
    group: 'People Ops',
  },
  {
    value: 'mhamilton',
    label: 'Margaret Hamilton',
    description: 'Head of People · People Ops',
    group: 'People Ops',
  },
  {
    value: 'jclarke',
    label: 'Joan Clarke',
    description: 'Payroll Specialist · Finance',
    group: 'Finance',
  },
  {
    value: 'aturing',
    label: 'Alan Turing',
    description: 'On garden leave',
    group: 'Finance',
    disabled: true,
  },
];

const countries: ComboboxOption[] = [
  { value: 'es', label: 'Spain', description: '412 employees' },
  { value: 'de', label: 'Germany', description: '188 employees' },
  { value: 'ie', label: 'Ireland', description: '96 employees' },
  { value: 'nl', label: 'Netherlands', description: '74 employees' },
  { value: 'pt', label: 'Portugal', description: '61 employees' },
  { value: 'fr', label: 'France', description: '43 employees' },
  { value: 'it', label: 'Italy', description: '22 employees' },
  { value: 'pl', label: 'Poland', description: '16 employees' },
];

const meta = {
  title: 'Forms/Combobox',
  component: Combobox,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A select you can type into.',
          '',
          '### When to use it instead of `Select`',
          '',
          'Below about ten options a native-backed `Select` is better in every way, including on iOS where it becomes the system wheel. Above that, scanning is slower than typing. Above a few hundred, the list has to be filtered on a server anyway: pass `onSearchChange` and hand it pre-filtered options.',
          '',
          'This is the control for *"pick a manager out of 900 people"*.',
          '',
          '### The ARIA is ours, and here is what it does',
          '',
          "It is an input plus a listbox rather than Radix's Select, because Select's trigger is a `<button>` and a button cannot be typed into. So:",
          '',
          '- the input is `role="combobox"` with `aria-expanded` and `aria-controls`;',
          '- the highlighted option is pointed at by `aria-activedescendant`, and **DOM focus stays in the input**: moving focus into the list would stop the user typing, and that is the reason it exists of the control;',
          '- the option count goes through a live region, so narrowing 900 names to 2 is audible and not merely visible.',
          '',
          '### Keyboard',
          '',
          '↑/↓ move the highlight and wrap, Home/End jump to the ends, Enter commits, Escape closes and returns focus to the trigger. In multiple mode the panel stays open on commit: picking four teams should not cost four round trips through the trigger.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    options: {
      description:
        'The list. `group` buckets options under a heading; `description` is the second line that disambiguates two people with the same name.',
      control: 'object',
      table: { type: { summary: 'readonly ComboboxOption[]' }, category: 'Data' },
    },
    value: {
      description: 'A string, or an array of strings when `multiple` is set. `null` for empty.',
      control: false,
      table: { type: { summary: 'string | readonly string[] | null' }, category: 'State' },
    },
    onChange: {
      description: 'Fires with the new value, a string, an array, or `null` when cleared.',
      control: false,
      table: { type: { summary: '(value) => void' }, category: 'State' },
    },
    multiple: {
      description: 'Allows several selections and keeps the panel open on commit.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Behaviour',
      },
    },
    label: {
      description: 'Required. Names the trigger, the search input and the listbox.',
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Accessibility' },
    },
    placeholder: {
      description: 'Shown on the trigger when nothing is selected.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Select…' },
        category: 'Content',
      },
    },
    searchPlaceholder: {
      description: 'Shown in the search input.',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'Search…' },
        category: 'Content',
      },
    },
    emptyMessage: {
      description:
        'Shown when nothing matches. Say what to do next where you can, "No matches. Try a surname." beats "No results".',
      control: 'text',
      table: {
        type: { summary: 'string' },
        defaultValue: { summary: 'No matches.' },
        category: 'Content',
      },
    },
    clearable: {
      description: 'Adds a clear affordance to the trigger once something is selected.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'Behaviour',
      },
    },
    size: {
      description: 'Matches `Button`, `Input` and `Select`.',
      control: 'inline-radio',
      options: ['sm', 'md', 'lg'],
      table: {
        type: { summary: "'sm' | 'md' | 'lg'" },
        defaultValue: { summary: 'md' },
        category: 'Appearance',
      },
    },
    disabled: {
      description: 'Blocks the trigger.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    onSearchChange: {
      description:
        'Switches off local filtering and hands you the query. This is the mode for a server-side list: pass back already-filtered `options`.',
      control: false,
      table: { type: { summary: '(query: string) => void' }, category: 'Data' },
    },
    loading: {
      description: 'Shows the busy state while a server-side search is in flight.',
      control: 'boolean',
      table: {
        type: { summary: 'boolean' },
        defaultValue: { summary: 'false' },
        category: 'State',
      },
    },
    className: {
      control: 'text',
      table: { type: { summary: 'string' }, category: 'Escape hatches' },
    },
  },
  args: {
    options: people,
    // Required props need a value in `args` or every story has to repeat them.
    // Each story below replaces these with real state.
    value: null,
    onChange: () => undefined,
    label: 'Manager',
    placeholder: 'Select a manager',
    searchPlaceholder: 'Search 912 people',
    multiple: false,
    clearable: true,
    size: 'md',
    disabled: false,
    loading: false,
  },
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

const renderControlled: NonNullable<Story['render']> = function ControlledCombobox(args) {
  const [value, setValue] = useState<string | readonly string[] | null>(null);
  return (
    <div className="w-80">
      <Combobox {...args} value={value} onChange={setValue} />
    </div>
  );
};

export const Playground: Story = { render: renderControlled };

export const Grouped: Story = {
  name: 'Grouped options',
  parameters: {
    docs: {
      description: {
        story:
          'Groups are headings inside the listbox, and the keyboard walks the *flat* order, the user arrows through the list they can see, not through the buckets it happens to be sorted into. Note that the disabled option stays visible with its reason in the description.',
      },
    },
  },
  render: renderControlled,
};

export const MultiSelect: Story = {
  name: 'Multiple',
  args: { multiple: true, label: 'Teams', placeholder: 'Any team', options: countries },
  parameters: {
    docs: {
      description: {
        story:
          'The panel stays open, the chosen values appear as badges above the list, and the trigger shows a count rather than a growing comma-separated string that would overflow the field.',
      },
    },
  },
  render: function MultiStory(args) {
    const [value, setValue] = useState<string | readonly string[] | null>(['es', 'de']);
    // `typeof`, not `Array.isArray`: the latter widens a `readonly string[]`
    // to `any[]` and takes every inference downstream with it.
    const selected: readonly string[] =
      value == null ? [] : typeof value === 'string' ? [value] : value;
    return (
      <div className="w-80 space-y-3">
        <Combobox {...args} value={value} onChange={setValue} />
        <div aria-live="polite" className="flex flex-wrap gap-1">
          {selected.length === 0 ? (
            <span className="text-sm text-fg-muted">No country filter: showing everyone</span>
          ) : (
            selected.map((code) => (
              <Badge key={code} tone="accent" size="sm">
                {countries.find((c) => c.value === code)?.label ?? code}
              </Badge>
            ))
          )}
        </div>
      </div>
    );
  },
};

export const WithIcons: Story = {
  name: 'With icons and avatars',
  parameters: {
    docs: {
      description: {
        story:
          'Icons are decoration and carry no meaning alone; the label does. An avatar earns its place here because it genuinely helps distinguish two people with similar names, which is the reason this control exists.',
      },
    },
  },
  render: function IconStory(args) {
    const [manager, setManager] = useState<string | readonly string[] | null>('rperlman');
    const [site, setSite] = useState<string | readonly string[] | null>('madrid');

    return (
      <div className="w-80 space-y-4">
        <Combobox
          {...args}
          label="Manager"
          value={manager}
          onChange={setManager}
          options={people.map((person) => ({
            ...person,
            icon: <Avatar size="xs" name={person.label} />,
          }))}
        />
        <Combobox
          {...args}
          label="Work location"
          placeholder="Select a location"
          searchPlaceholder="Search locations"
          value={site}
          onChange={setSite}
          options={[
            {
              value: 'madrid',
              label: 'Madrid. Gran Vía',
              description: 'Hybrid · 3 days on site',
              icon: <Building2 />,
            },
            {
              value: 'berlin',
              label: 'Berlin. Mitte',
              description: 'Hybrid · 2 days on site',
              icon: <Building2 />,
            },
            {
              value: 'remote-es',
              label: 'Remote. Spain',
              description: 'Fully remote',
              icon: <MapPin />,
            },
            {
              value: 'remote-de',
              label: 'Remote. Germany',
              description: 'Fully remote',
              icon: <MapPin />,
            },
          ]}
        />
      </div>
    );
  },
};

export const ServerSide: Story = {
  name: 'Server-side search',
  parameters: {
    docs: {
      description: {
        story:
          'With `onSearchChange` set, local filtering is off and the query is yours. This story fakes a 400ms round trip. The important detail is that the live region announces the new count once results land, so a screen-reader user learns the search finished. They cannot see the list change.',
      },
    },
  },
  render: function ServerStory(args) {
    const [value, setValue] = useState<string | readonly string[] | null>(null);
    const [results, setResults] = useState<ComboboxOption[]>(people);
    const [loading, setLoading] = useState(false);

    return (
      <div className="w-80">
        <Combobox
          {...args}
          value={value}
          onChange={setValue}
          options={results}
          loading={loading}
          emptyMessage="No matches. Try a surname."
          onSearchChange={(query) => {
            setLoading(true);
            setTimeout(() => {
              const needle = query.toLowerCase();
              setResults(
                query === ''
                  ? people
                  : people.filter((person) => person.label.toLowerCase().includes(needle)),
              );
              setLoading(false);
            }, 400);
          }}
        />
      </div>
    );
  },
};

export const Sizes: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The same control heights as `Button`, `Input` and `Select`. Switch the toolbar viewport to an iPhone and all four grow to the 44px floor together, because the height is a density token rather than a per-component constant.',
      },
    },
  },
  render: function SizeStory(args) {
    const [value, setValue] = useState<string | readonly string[] | null>('ghopper');
    return (
      <div className="w-80 space-y-3">
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <Combobox
            key={size}
            {...args}
            size={size}
            label={`Manager, ${size}`}
            value={value}
            onChange={setValue}
          />
        ))}
      </div>
    );
  },
};
