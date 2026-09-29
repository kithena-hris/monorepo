import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../button/button';
import { Chip } from '../chip/chip';
import { FilterBuilder } from './filter-builder';
import {
  conditionsOf,
  describeFilter,
  isConditionComplete,
  type FilterGroup,
} from './filter-model';
import { peopleFields } from './fixtures';

const twoConditions: FilterGroup = {
  match: 'all',
  conditions: [
    { id: 'c1', field: 'team', operator: 'in', values: ['engineering', 'design'] },
    { id: 'c2', field: 'start', operator: 'between', values: ['2024-01-01', '2024-03-31'] },
  ],
};

let next = 0;
const newId = (): string => {
  next += 1;
  return `new-${String(next)}`;
};

const meta = {
  title: 'Components/FilterBuilder',
  component: FilterBuilder,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Build a filter out of conditions: a field, an operator and a value, joined by "and" or "or". Applied filters then show as chips above the results.',
          '',
          '### Presentational',
          '',
          'The application supplies the fields, the operators it will honour for each (and the kind of value each asks for: text, a number, a date, a period, one option or any of them), and the options it may offer. The builder evaluates nothing and holds no state, so the application decides whether a change applies at once or waits for an Apply.',
          '',
          '### Values are canonical strings',
          '',
          'A text, a number, an ISO date, an option key, never a rendered label: a relabelled option does not silently break a saved filter. `isConditionComplete` says whether a row has said enough to apply, and `describeFilter()` turns the whole value into the one sentence people read to check it.',
          '',
          'With a `title` the builder is a card of its own with a Clear; without one it is the bare rows, for a panel that has its own. `allowGroups` is the advanced mode: see Complex filters. Under a finger each condition becomes a small card with its parts stacked.',
        ].join('\n'),
      },
    },
  },
  args: {
    fields: peopleFields,
    value: twoConditions,
    onChange: fn(),
    newId,
    title: 'Filters',
  },
} satisfies Meta<typeof FilterBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [value, setValue] = useState(args.value);
    const all = conditionsOf(value);
    const complete = all.filter((c) => isConditionComplete(peopleFields, c)).length;
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        <FilterBuilder
          {...args}
          value={value}
          onChange={(v) => {
            args.onChange(v);
            setValue(v);
          }}
          action={
            <Button size="sm" variant="primary">
              Show 48 people
            </Button>
          }
        />
        <p aria-live="polite" className="text-sm text-fg-muted">
          {complete} of {all.length} conditions ready to apply
        </p>
      </div>
    );
  },
};

export const InAPanel: Story = {
  name: 'In a panel',
  parameters: {
    docs: {
      description: {
        story:
          'No `title`: the bare rows, for a sheet or a side panel that already has a heading, a Clear and an Apply of its own.',
      },
    },
  },
  args: { title: undefined, label: 'Conditions' },
  render: function PanelStory(args) {
    const [value, setValue] = useState(args.value);
    return <FilterBuilder {...args} className="max-w-3xl" value={value} onChange={setValue} />;
  },
};

export const NothingYet: Story = {
  name: 'Nothing yet',
  render: function EmptyStory(args) {
    const [value, setValue] = useState<FilterGroup>({ match: 'all', conditions: [] });
    return (
      <FilterBuilder
        {...args}
        className="max-w-md"
        value={value}
        onChange={setValue}
        emptyDescription="Add a condition to narrow down 312 people."
      />
    );
  },
};

export const AnyCondition: Story = {
  name: 'Any condition',
  parameters: {
    docs: {
      description: {
        story:
          'Switched to **Any**, the joins read "or". The salary condition has no value, and the caller has said so through `errors`, keyed by the condition id: the builder shows the message, it never decides what is valid. An operator that needs no value, like "is empty", takes no input at all.',
      },
    },
  },
  render: function AnyStory(args) {
    const [value, setValue] = useState<FilterGroup>({
      match: 'any',
      conditions: [
        { id: 'c1', field: 'location', operator: 'is', values: ['berlin'] },
        { id: 'c2', field: 'phone', operator: 'empty', values: [] },
        { id: 'c3', field: 'salary', operator: 'above', values: [] },
      ],
    });
    const missing = Object.fromEntries(
      value.conditions.flatMap((c) =>
        isConditionComplete(peopleFields, c) ? [] : [[c.id, 'Enter an amount']],
      ),
    );
    return (
      <FilterBuilder
        {...args}
        className="max-w-3xl"
        value={value}
        onChange={setValue}
        errors={missing}
        action={
          <Button size="sm" variant="primary">
            Show 96 people
          </Button>
        }
      />
    );
  },
};

export const AppliedAsChips: Story = {
  name: 'Applied, as removable chips',
  parameters: {
    docs: {
      description: {
        story:
          'Once applied, each condition is a `Chip` above the results: the field muted, then the value, and a remove button named for what it removes, so "Remove Team is Engineering" is what a screen reader hears.',
      },
    },
  },
  render: function ChipsStory() {
    const [value, setValue] = useState<FilterGroup>({
      match: 'all',
      conditions: [
        { id: 'c1', field: 'team', operator: 'is', values: ['engineering'] },
        { id: 'c2', field: 'start', operator: 'after', values: ['2024-01-01'] },
        { id: 'c3', field: 'location', operator: 'is', values: ['berlin'] },
      ],
    });
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {value.conditions.map((item) => {
            const field = peopleFields.find((entry) => entry.id === item.field);
            const operator = field?.operators.find((entry) => entry.id === item.operator);
            const first = item.values[0] ?? '';
            const shown = field?.options?.find((option) => option.value === first)?.label ?? first;
            return (
              <Chip
                key={item.id}
                selected
                field={field?.label ?? item.field}
                // The field names the subject, so the value reads without its
                // "is": "Team Engineering", "Start after 2024-01-01".
                removeLabel={`Remove ${describeFilter({ ...value, conditions: [item] }, peopleFields)}`}
                onRemove={() => {
                  setValue({ ...value, conditions: value.conditions.filter((c) => c !== item) });
                }}
              >
                {item.operator === 'is'
                  ? shown
                  : `${(operator?.label ?? item.operator).replace(/^is /, '')} ${shown}`}
              </Chip>
            );
          })}
          {value.conditions.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setValue({ ...value, conditions: [] });
              }}
            >
              Clear all
            </Button>
          ) : null}
        </div>
        <p aria-live="polite" className="text-sm text-fg-muted">
          {value.conditions.length === 0 ? 'Everyone, 312 people' : `${String(48)} people match`}
        </p>
      </div>
    );
  },
};
