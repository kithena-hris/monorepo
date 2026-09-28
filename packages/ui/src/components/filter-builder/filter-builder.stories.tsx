import type { Meta, StoryObj } from '@storybook/react-vite';
import { X } from 'lucide-react';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../button/button';
import { FilterBuilder } from './filter-builder';
import { describeFilter, type FilterGroup } from './filter-model';
import { peopleFields } from './fixtures';

const twoConditions: FilterGroup = {
  kind: 'group',
  id: 'root',
  match: 'all',
  items: [
    { kind: 'condition', id: 'c1', field: 'team', operator: 'is', value: 'engineering' },
    { kind: 'condition', id: 'c2', field: 'start', operator: 'after', value: '2024-01-01' },
  ],
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
          'Controlled, and the value is plain data (`FilterGroup`), changed only through the helpers in `filter-model`. `describeFilter()` turns it into one sentence, which is what people read to check a filter. `allowGroups` is the advanced mode: see Complex filters.',
          '',
          'Under a finger each condition becomes a small card with its parts stacked.',
        ].join('\n'),
      },
    },
  },
  args: {
    fields: peopleFields,
    value: twoConditions,
    onChange: fn(),
  },
} satisfies Meta<typeof FilterBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [value, setValue] = useState(args.value);
    return (
      <FilterBuilder
        {...args}
        className="max-w-3xl"
        value={value}
        onChange={(next) => {
          args.onChange(next);
          setValue(next);
        }}
        action={
          <Button size="sm" variant="primary">
            Show 48 people
          </Button>
        }
      />
    );
  },
};

export const NothingYet: Story = {
  name: 'Nothing yet',
  render: function EmptyStory(args) {
    const [value, setValue] = useState<FilterGroup>({
      kind: 'group',
      id: 'root',
      match: 'all',
      items: [],
    });
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
          'Switched to **Any**, the joins read "or". The salary condition has no value, and the caller has said so through `errors`, keyed by the condition id: the builder shows the message, it never decides what is valid.',
      },
    },
  },
  render: function AnyStory(args) {
    const [value, setValue] = useState<FilterGroup>({
      kind: 'group',
      id: 'root',
      match: 'any',
      items: [
        { kind: 'condition', id: 'c1', field: 'location', operator: 'is', value: 'berlin' },
        { kind: 'condition', id: 'c2', field: 'location', operator: 'is', value: 'remote' },
        { kind: 'condition', id: 'c3', field: 'salary', operator: 'above', value: '' },
      ],
    });
    const missing = Object.fromEntries(
      value.items.flatMap((item) =>
        item.kind === 'condition' && item.value === '' ? [[item.id, 'Enter an amount']] : [],
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
          'Once applied, each condition is a chip above the results, and pressing it removes that condition. The chips are buttons named for what they remove, so "Remove Team is Engineering" is what a screen reader hears.',
      },
    },
  },
  render: function ChipsStory() {
    const [value, setValue] = useState<FilterGroup>({
      kind: 'group',
      id: 'root',
      match: 'all',
      items: [
        { kind: 'condition', id: 'c1', field: 'team', operator: 'is', value: 'engineering' },
        { kind: 'condition', id: 'c2', field: 'start', operator: 'after', value: '2024-01-01' },
        { kind: 'condition', id: 'c3', field: 'location', operator: 'is', value: 'berlin' },
      ],
    });
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {value.items.map((item) => {
            const one: FilterGroup = { ...value, items: [item] };
            const text = describeFilter(one, peopleFields);
            return (
              <Button
                key={item.id}
                size="sm"
                variant="subtle"
                className="rounded-full"
                endIcon={<X />}
                aria-label={`Remove ${text}`}
                onClick={() => {
                  setValue({ ...value, items: value.items.filter((entry) => entry !== item) });
                }}
              >
                {text}
              </Button>
            );
          })}
          {value.items.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setValue({ ...value, items: [] });
              }}
            >
              Clear all
            </Button>
          ) : null}
        </div>
        <p aria-live="polite" className="text-sm text-fg-muted">
          {value.items.length === 0 ? 'Everyone, 312 people' : `${String(48)} people match`}
        </p>
      </div>
    );
  },
};
