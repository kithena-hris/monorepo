import type { Meta, StoryObj } from '@storybook/react-vite';
import { Mail, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Card } from '../card/card';
import { Chip, ChipGroup, ChipGroupItem } from './chip';

const meta = {
  title: 'Components/Chip',
  component: Chip,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Compact, tappable choices. Filter chips narrow results, input chips hold values, and suggestion chips offer a next step. For a status, use a `Badge`.',
          '',
          '| Kind | Build it with | Semantics |',
          '| --- | --- | --- |',
          '| Filter | `ChipGroup type="multiple"`, or one `Chip selected` | Toggle buttons (`aria-pressed`), with a tick when on |',
          '| Choice | `ChipGroup type="single"` | A radio group; arrow keys move the choice |',
          '| Input | `Chip onRemove` | A value, and a remove button named after it |',
          '| Suggestion | `Chip variant="dashed"` | A plain button: it acts, it holds nothing |',
          '',
          'Under a finger a chip grows to 36px and its hit area to the 44px floor, and a `scroll` group becomes one row that scrolls from edge to edge.',
        ].join('\n'),
      },
    },
  },
  argTypes: {
    selected: {
      description:
        'Filter-chip state. Present, the chip is a toggle button with `aria-pressed` and a tick when on.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    variant: {
      description: '`dashed` for a suggestion or an "Add filter" chip: an offer, not a value.',
      control: 'inline-radio',
      options: ['filled', 'dashed'],
      table: {
        type: { summary: "'filled' | 'dashed'" },
        defaultValue: { summary: 'filled' },
        category: 'Appearance',
      },
    },
    invalid: {
      description: 'An input chip whose value failed validation, such as a half-typed email.',
      control: 'boolean',
      table: { type: { summary: 'boolean' }, category: 'State' },
    },
    field: {
      description: 'The filter this chip holds, shown muted before the value.',
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
    onRemove: {
      description: 'Makes this an input chip with a trailing remove button.',
      control: false,
      table: { type: { summary: '() => void' }, category: 'Events' },
    },
    children: {
      control: 'text',
      table: { type: { summary: 'ReactNode' }, category: 'Content' },
    },
  },
  args: { children: 'Engineering' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [on, setOn] = useState(true);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Chip {...args} selected={false} />
        <Chip
          {...args}
          selected={on}
          onClick={() => {
            setOn(!on);
          }}
        />
      </div>
    );
  },
};

const teams = ['All', 'Engineering', 'Design', 'Sales', 'Support', 'Remote'];

export const FilterChips: Story = {
  name: 'Filter chips',
  parameters: {
    docs: {
      description: {
        story:
          'More than one can be on at a time. The tick shows the state, so it doesn’t rely on colour alone.',
      },
    },
  },
  render: () => (
    <ChipGroup type="multiple" defaultValue={['All', 'Engineering']} aria-label="Teams">
      {teams.map((team) => (
        <ChipGroupItem key={team} value={team}>
          {team}
        </ChipGroupItem>
      ))}
    </ChipGroup>
  ),
};

export const ChoiceChips: Story = {
  name: 'Choice chips',
  parameters: {
    docs: { description: { story: 'Exactly one is on, like a radio group.' } },
  },
  render: () => (
    <ChipGroup type="single" defaultValue="Full-time" aria-label="Contract type">
      {['Full-time', 'Part-time', 'Contractor', 'Intern'].map((kind) => (
        <ChipGroupItem key={kind} value={kind}>
          {kind}
        </ChipGroupItem>
      ))}
    </ChipGroup>
  ),
};

export const InputChips: Story = {
  name: 'Input chips',
  parameters: {
    docs: {
      description: {
        story:
          'Values somebody picked or typed. Each remove button is named after its value, so a screen reader hears "Remove Priya Shah" rather than four identical "Remove" buttons.',
      },
    },
  },
  render: function InputChipsStory() {
    const [values, setValues] = useState(['Priya Shah', 'Jonas Weber']);
    const remove = (name: string) => () => {
      setValues(values.filter((value) => value !== name));
    };
    return (
      <div className="flex flex-wrap items-center gap-2">
        {values.map((name) => (
          <Chip
            key={name}
            startIcon={<Avatar name={name} size="xs" className="touch:size-6" />}
            onRemove={remove(name)}
          >
            {name}
          </Chip>
        ))}
        <Chip startIcon={<Mail aria-hidden="true" />} onRemove={() => undefined}>
          design@reach.co
        </Chip>
        <Chip invalid onRemove={() => undefined} removeLabel="Remove jonas@, not a valid email">
          jonas@
        </Chip>
      </div>
    );
  },
};

export const SuggestionChips: Story = {
  name: 'Suggestion chips',
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {['Request time off', 'Show my payslip', 'Who is out today?'].map((label) => (
        <Chip key={label} variant="dashed" startIcon={<Sparkles aria-hidden="true" />}>
          {label}
        </Chip>
      ))}
    </div>
  ),
};

export const KeyAndValue: Story = {
  name: 'Key and value',
  parameters: {
    docs: {
      description: {
        story:
          'An applied filter reads as one phrase, the field muted and the value in full. The remove button takes the filter off.',
      },
    },
  },
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Chip selected field="Team" onRemove={() => undefined}>
        Engineering
      </Chip>
      <Chip selected field="Location" onRemove={() => undefined}>
        Berlin, London
      </Chip>
      <Chip selected field="Start" onRemove={() => undefined}>
        After 1 Jan 2024
      </Chip>
      <Chip variant="dashed" startIcon={<Plus aria-hidden="true" />}>
        Add filter
      </Chip>
    </div>
  ),
};

export const Overflow: Story = {
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'On a phone, chips scroll sideways in a single row from edge to edge. At a desk the same row wraps; past a handful, show the first few and a "+4 more" chip that opens the full list.',
      },
    },
  },
  render: () => (
    <ChipGroup type="single" defaultValue="Engineering" scroll aria-label="Department">
      {['All', 'Engineering', 'Design', 'Sales', 'Support', 'Finance', 'People'].map((team) => (
        <ChipGroupItem key={team} value={team}>
          {team}
        </ChipGroupItem>
      ))}
    </ChipGroup>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Chip disabled>Contractor</Chip>
      <Chip disabled selected>
        Engineering
      </Chip>
    </div>
  ),
};

export const ChipBadgeOrButton: Story = {
  name: 'Chip, badge or button?',
  parameters: { layout: 'padded' },
  render: () => (
    <div className="@container">
      <div className="grid gap-2.5 @xl:grid-cols-3">
        <Card className="flex flex-col items-start gap-2 p-4">
          <Chip selected>Berlin</Chip>
          <p className="font-semibold">Chip</p>
          <p className="text-sm text-fg-muted">You can tap it. It picks or holds a value.</p>
        </Card>
        <Card className="flex flex-col items-start gap-2 p-4">
          <Badge tone="success" dot>
            Active
          </Badge>
          <p className="font-semibold">Badge</p>
          <p className="text-sm text-fg-muted">You can’t tap it. It shows a status.</p>
        </Card>
        <Card className="flex flex-col items-start gap-2 p-4">
          <Button variant="primary" size="sm">
            Save
          </Button>
          <p className="font-semibold">Button</p>
          <p className="text-sm text-fg-muted">It does something once.</p>
        </Card>
      </div>
    </div>
  ),
};
