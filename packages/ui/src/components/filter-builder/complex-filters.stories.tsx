import type { Meta, StoryObj } from '@storybook/react-vite';
import { BookmarkPlus, SearchX, SlidersHorizontal, X } from 'lucide-react';
import { useState, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Chip } from '../chip/chip';
import { Checkbox } from '../checkbox/checkbox';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../dialog/dialog';
import { EmptyState } from '../feedback/feedback';
import { Field, FieldLabel } from '../field/field';
import { Input } from '../input/input';
import { RadioGroup, RadioGroupItem } from '../radio-group/radio-group';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../sheet/sheet';
import { Slider } from '../slider/slider';
import { Tabs, TabsList, TabsTrigger } from '../tabs/tabs';
import { ToggleGroup, ToggleGroupItem } from '../toggle/toggle';
import { FilterBuilder } from './filter-builder';
import { describeFilter, type FilterGroup } from './filter-model';
import { peopleFields } from './fixtures';

const meta = {
  title: 'Components/Complex filters',
  component: FilterBuilder,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'For big lists: saved views, facets with counts, nested and/or groups, and a way back when nothing matches. Every filter is shown as a chip you can remove.',
          '',
          'The nested groups are `FilterBuilder` with `allowGroups`. The rest is composed from the system: `Tabs` for saved views, `Checkbox` rows for facets, `Slider` and date inputs for ranges, a `Sheet` to hold them on a phone.',
        ].join('\n'),
      },
    },
  },
  args: {
    fields: peopleFields,
    value: { match: 'all', conditions: [] },
    onChange: () => undefined,
  },
} satisfies Meta<typeof FilterBuilder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SavedViews: Story = {
  name: 'Saved views',
  render: function SavedViewsStory() {
    const [chips, setChips] = useState([
      ['Team', 'Engineering'],
      ['Location', 'Berlin or Remote'],
      ['Status', 'Active'],
    ]);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs defaultValue="all">
            <TabsList aria-label="Saved views">
              <TabsTrigger value="all">All people 312</TabsTrigger>
              <TabsTrigger value="team">My team 12</TabsTrigger>
              <TabsTrigger value="new">New joiners 8</TabsTrigger>
              <TabsTrigger value="leavers">Leavers 4</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" variant="ghost" startIcon={<BookmarkPlus />}>
            Save view
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(([field, value]) => (
            <Chip
              key={field}
              selected
              field={field}
              onRemove={() => {
                setChips(chips.filter(([entry]) => entry !== field));
              }}
            >
              {value}
            </Chip>
          ))}
          <Chip variant="dashed" startIcon={<SlidersHorizontal aria-hidden />}>
            More filters
          </Chip>
        </div>
        <p aria-live="polite" className="text-sm text-fg-muted">
          48 of 312 people
        </p>
      </div>
    );
  },
};

type Facet = readonly [label: string, count: number];

function FacetList({
  title,
  options,
  picked,
  onToggle,
}: {
  title: string;
  options: readonly Facet[];
  picked: ReadonlySet<string>;
  onToggle: (label: string) => void;
}): JSX.Element {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-semibold text-fg touch:text-base">{title}</legend>
      {options.map(([label, count]) => (
        // A zero is dimmed but still pickable: it may not be zero once another
        // facet changes, and a control that disables itself is a puzzle.
        <label
          key={label}
          className={cn(
            'flex min-h-7 cursor-pointer items-center gap-2.5 text-sm text-fg touch:min-h-10 touch:text-base',
            count === 0 && 'text-fg-muted',
          )}
        >
          <Checkbox
            checked={picked.has(label)}
            onCheckedChange={() => {
              onToggle(label);
            }}
          />
          <span className="flex-1">{label}</span>
          <span className="text-xs font-medium text-fg-muted tabular-nums">{count}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Facets(): JSX.Element {
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    new Set(['Engineering', 'Berlin', 'Remote']),
  );
  const toggle = (label: string): void => {
    const next = new Set(picked);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    setPicked(next);
  };
  return (
    <div className="flex flex-col gap-5">
      <FacetList
        title="Team"
        options={[
          ['Engineering', 124],
          ['Sales', 64],
          ['Support', 48],
          ['Design', 28],
        ]}
        picked={picked}
        onToggle={toggle}
      />
      <FacetList
        title="Location"
        options={[
          ['Berlin', 98],
          ['London', 64],
          ['Remote', 82],
          ['Tokyo', 0],
        ]}
        picked={picked}
        onToggle={toggle}
      />
      <Slider
        label="Salary"
        thumbLabels={['Minimum salary', 'Maximum salary']}
        min={40}
        max={140}
        defaultValue={[60, 110]}
        valueDisplay="€60k – €110k"
      />
    </div>
  );
}

export const FacetsWithCounts: Story = {
  name: 'Facets with counts',
  parameters: {
    docs: {
      description: {
        story:
          'Counts update as you pick, and an option with 0 results is dimmed but can still be picked.',
      },
    },
  },
  render: () => (
    <div className="max-w-xs rounded-lg bg-surface p-5 shadow-sm touch:max-w-none touch:p-4">
      <Facets />
    </div>
  ),
};

export const NestedGroups: Story = {
  name: 'Nested and/or groups',
  parameters: {
    docs: {
      description: {
        story:
          'One level of groups at most. The plain-language summary underneath is what people actually read, and it comes from `describeFilter()`.',
      },
    },
  },
  render: function NestedStory() {
    const [value, setValue] = useState<FilterGroup>({
      match: 'all',
      conditions: [
        { id: 'c1', field: 'team', operator: 'is', values: ['engineering'] },
        { id: 'c2', field: 'contract', operator: 'is', values: ['permanent'] },
      ],
      groups: [
        {
          id: 'g1',
          match: 'any',
          conditions: [
            { id: 'c3', field: 'location', operator: 'is', values: ['berlin'] },
            { id: 'c4', field: 'location', operator: 'is', values: ['remote'] },
          ],
        },
      ],
    });
    return (
      <div className="max-w-3xl space-y-3">
        <FilterBuilder
          fields={peopleFields}
          value={value}
          onChange={setValue}
          allowGroups
          title="Who should get this policy?"
          action={
            <Button size="sm" variant="primary">
              Apply · 64 people
            </Button>
          }
        />
        <p aria-live="polite" className="px-1 text-sm text-fg-muted">
          {describeFilter(value, peopleFields) || 'Everyone'}
        </p>
      </div>
    );
  },
};

export const RangesAndDates: Story = {
  name: 'Ranges and dates',
  render: function RangesStory() {
    const [preset, setPreset] = useState('custom');
    return (
      <div className="flex max-w-lg flex-col gap-5 rounded-lg bg-surface p-5 shadow-sm touch:p-4">
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-base font-semibold text-fg">Start date</legend>
          <ToggleGroup
            type="single"
            aria-label="Start date range"
            value={preset}
            onValueChange={(next) => {
              if (next) setPreset(next);
            }}
            className="flex-wrap"
          >
            <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
            <ToggleGroupItem value="quarter">This quarter</ToggleGroupItem>
            <ToggleGroupItem value="year">This year</ToggleGroupItem>
            <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-end gap-2 touch:flex-col touch:items-stretch">
            <Field className="flex-1">
              <FieldLabel>From</FieldLabel>
              <Input type="date" defaultValue="2024-01-01" />
            </Field>
            <Field className="flex-1">
              <FieldLabel>To</FieldLabel>
              <Input type="date" defaultValue="2026-09-30" />
            </Field>
          </div>
        </fieldset>
        <Slider
          label="Tenure"
          thumbLabels={['Shortest tenure', 'Longest tenure']}
          min={0}
          max={10}
          step={1}
          defaultValue={[1, 5]}
          valueDisplay="1 – 5 years"
          showTicks
        />
      </div>
    );
  },
};

export const SavingAView: Story = {
  name: 'Saving a view',
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button startIcon={<BookmarkPlus />}>Save view</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this view</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input defaultValue="Berlin engineers" />
          </Field>
          <RadioGroup defaultValue="me" aria-label="Who can see it">
            <RadioGroupItem value="me">Only me</RadioGroupItem>
            <RadioGroupItem value="team">Everyone in People team</RadioGroupItem>
          </RadioGroup>
          <p className="text-sm text-fg-muted">Saves 3 filters and the Name A–Z sort.</p>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="primary">Save view</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const ZeroResults: Story = {
  name: 'Zero results, with a way out',
  parameters: {
    docs: {
      description: {
        story:
          'Name the filter that emptied the list and offer to drop it, with how many people would come back. "No results" on its own tells people what they can already see.',
      },
    },
  },
  render: () => (
    <EmptyState
      className="max-w-lg border-0 bg-surface shadow-sm"
      icon={<SearchX />}
      title="No one matches all 4 filters"
      description="The Tokyo filter removes everyone. Try one of these:"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Chip startIcon={<X aria-hidden />}>Remove Tokyo · 48</Chip>
          <Chip startIcon={<X aria-hidden />}>Remove Active · 3</Chip>
          <Button size="sm" variant="ghost">
            Clear all
          </Button>
        </div>
      }
    />
  ),
};

export const FilterSheet: Story = {
  name: 'Filter sheet',
  parameters: {
    docs: {
      description: {
        story:
          'On a phone the facets move into a sheet with the result count on its button, so people see what applying will do before they do it.',
      },
    },
  },
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button startIcon={<SlidersHorizontal />}>
          Filters <Badge size="sm">3</Badge>
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <Facets />
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost">Clear</Button>
          <Button variant="primary">Show 48 people</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};
