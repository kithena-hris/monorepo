import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Baby, Briefcase, Sun, Thermometer } from 'lucide-react-native';
import { useEffect, useState } from 'react';

import { overlayDocs } from '../../docs/design.ts';
import { PEOPLE } from '../../docs/people.ts';
import { Stage, settled } from '../../docs/stage.tsx';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../dialog/dialog.tsx';
import { Field, FieldDescription, FieldLabel } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';
import { Stack } from '../layout/layout.tsx';
import { Combobox, type ComboboxOption, type ComboboxProps } from './combobox.tsx';

const meta = {
  title: 'Forms/Combobox',
  component: Combobox,
  parameters: overlayDocs('combobox'),
  // axe runs after this, on the open list, not on its fade in.
  play: settled,
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj;

const teams: readonly ComboboxOption[] = [
  'Engineering',
  'Engineering Management',
  'Sales Engineering',
  'Design',
  'Finance',
  'People',
  'Platform',
  'Sales',
  'Support',
].map((t) => ({ value: t, label: t }));

const person = (name: string): React.JSX.Element => <Avatar name={name} size="md" decorative />;

const people: readonly ComboboxOption[] = PEOPLE.map((p) => ({
  value: p.name,
  label: p.name,
  description: p.team,
  icon: person(p.name),
}));

/** An open combobox on the design's stage: the trigger on the page, the list over it. */
function Open({
  height = 560,
  initial = null,
  ...props
}: Omit<ComboboxProps, 'value' | 'onChange' | 'portalHost'> & {
  height?: number;
  initial?: ComboboxProps['value'];
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <Stage
      height={height}
      trigger={(host) => (
        <Combobox defaultOpen portalHost={host} value={value} onChange={setValue} {...props} />
      )}
    />
  );
}

export const Playground: Story = {
  render: () => <Open label="Team" options={teams} defaultQuery="eng" />,
};

export const GroupedOptions: Story = {
  name: 'Grouped options',
  render: () => (
    <Open
      label="Share with"
      defaultQuery="e"
      options={[
        { value: 'eng', label: 'Engineering', group: 'Teams' },
        { value: 'design', label: 'Design', group: 'Teams' },
        { value: 'priya', label: 'Priya Shah', group: 'People', icon: person('Priya Shah') },
        { value: 'jonas', label: 'Jonas Weber', group: 'People', icon: person('Jonas Weber') },
      ]}
    />
  ),
};

const offices: readonly ComboboxOption[] = ['Berlin', 'London', 'Paris', 'Madrid', 'Remote'].map(
  (o) => ({ value: o, label: o }),
);

export const Multiple: Story = {
  render: () => (
    <Open label="Offices" multiple options={offices} initial={['Berlin', 'London', 'Remote']} />
  ),
};

export const MultipleChips: Story = {
  name: 'Multiple, with removable chips',
  render: function ChipsStory() {
    const [value, setValue] = useState<ComboboxProps['value']>([
      'Priya Shah',
      'Jonas Weber',
      'Mei Tanaka',
    ]);
    return (
      <Field>
        <FieldLabel>Reviewers</FieldLabel>
        <Combobox
          label="Reviewers"
          multiple
          chips
          placeholder="Add a reviewer"
          options={people}
          value={value}
          onChange={setValue}
        />
      </Field>
    );
  },
};

const leave: readonly ComboboxOption[] = [
  { value: 'vacation', label: 'Vacation', icon: <Icon icon={Sun} size={20} tone="muted" /> },
  {
    value: 'sick',
    label: 'Sick leave',
    icon: <Icon icon={Thermometer} size={20} tone="muted" />,
  },
  { value: 'parental', label: 'Parental', icon: <Icon icon={Baby} size={20} tone="muted" /> },
  { value: 'unpaid', label: 'Unpaid', icon: <Icon icon={Briefcase} size={20} tone="muted" /> },
];

export const WithIconsAndAvatars: Story = {
  name: 'With icons and avatars',
  render: function IconsStory() {
    const [type, setType] = useState<ComboboxProps['value']>('vacation');
    return (
      <Stack className="gap-3.5">
        <Combobox label="Leave type" options={leave} value={type} onChange={setType} />
        <Open label="Manager" options={people.slice(0, 4)} height={480} />
      </Stack>
    );
  },
};

const everyone: readonly ComboboxOption[] = [
  {
    value: 'Lucas Moreau',
    label: 'Lucas Moreau',
    description: 'Sales',
    icon: person('Lucas Moreau'),
  },
];

export const ServerSideSearch: Story = {
  name: 'Server-side search',
  render: function ServerStory() {
    const [query, setQuery] = useState('mor');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
      setLoading(true);
      // Stands in for the request: the list is already the server's answer.
      const done = setTimeout(() => {
        setLoading(false);
      }, 60_000);
      return () => {
        clearTimeout(done);
      };
    }, [query]);
    return (
      <Open
        label="Person"
        options={everyone.filter((p) => p.label.toLowerCase().includes(query.trim().toLowerCase()))}
        defaultQuery="mor"
        onSearchChange={setQuery}
        loading={loading}
        footer="Searching all 312 people…"
      />
    );
  },
};

export const Sizes: Story = {
  render: function SizesStory() {
    const [team, setTeam] = useState<ComboboxProps['value']>('Design');
    return (
      <Stack className="gap-2.5">
        <Combobox label="Team, compact" size="sm" options={teams} value={team} onChange={setTeam} />
        <Combobox label="Team" options={teams} value={team} onChange={setTeam} />
      </Stack>
    );
  },
};

export const InAField: Story = {
  name: 'In a Field',
  render: function InAFieldStory() {
    const [manager, setManager] = useState<ComboboxProps['value']>('Jonas Weber');
    return (
      <Field>
        <FieldLabel>Manager</FieldLabel>
        <Combobox
          label="Manager"
          options={PEOPLE.map((p) => ({
            value: p.name,
            label: p.name,
            description: p.team,
            icon: <Avatar name={p.name} size="sm" decorative />,
          }))}
          value={manager}
          onChange={setManager}
        />
        <FieldDescription>Approves time off and expenses.</FieldDescription>
      </Field>
    );
  },
};

const managers: readonly ComboboxOption[] = [
  'Nora Becker',
  'Omar Haddad',
  'Jonas Weber',
  'Priya Shah',
].map((n) => ({ value: n, label: n, icon: person(n) }));

export const InADialog: Story = {
  name: 'In A Dialog',
  render: function InADialogStory() {
    const [manager, setManager] = useState<ComboboxProps['value']>(null);
    return (
      <Dialog defaultOpen>
        <Stage
          trigger={
            <DialogTrigger asChild>
              <Button size="sm">Change manager</Button>
            </DialogTrigger>
          }
        >
          {(host) => (
            <DialogContent portalHost={host}>
              <DialogHeader>
                <DialogTitle>Change manager</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <Combobox
                  inline
                  label="New manager"
                  searchPlaceholder="Search people"
                  defaultQuery="No"
                  options={managers}
                  value={manager}
                  onChange={setManager}
                />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button>Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="primary">Change</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          )}
        </Stage>
      </Dialog>
    );
  },
};

export const CreatingANewOption: Story = {
  name: 'Creating a new option',
  render: function CreateStory() {
    const [options, setOptions] = useState(teams);
    const [value, setValue] = useState<ComboboxProps['value']>(null);
    return (
      <Stage
        height={480}
        trigger={(host) => (
          <Combobox
            defaultOpen
            portalHost={host}
            label="Team"
            defaultQuery="Platform Infra"
            options={options.filter((o) => o.value !== 'Engineering Management')}
            value={value}
            onChange={setValue}
            onCreate={(name) => {
              setOptions([...options, { value: name, label: name }]);
              setValue(name);
            }}
          />
        )}
      />
    );
  },
};

export const NothingFound: Story = {
  name: 'Nothing found',
  render: () => (
    <Open
      label="Team"
      options={teams}
      defaultQuery="xyz"
      height={480}
      emptyMessage={(query) => `No teams match “${query}”`}
    />
  ),
};
