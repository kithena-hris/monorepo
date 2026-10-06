import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { BookmarkPlus, ChevronRight, SearchX, SlidersHorizontal, X } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Text as CssText, View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Note } from '../../docs/notes.tsx';
import { PEOPLE, STATUS_TONE } from '../../docs/people.ts';
import { settled, Stage } from '../../docs/stage.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { Card } from '../card/card.tsx';
import { Chip, ChipGroup, ChipGroupItem } from '../chip/chip.tsx';
import { DatePicker } from '../date-picker/date-picker.tsx';
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
import { EmptyState } from '../feedback/feedback.tsx';
import { Field, FieldLabel } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import { List, ListItem } from '../list-item/list-item.tsx';
import { RadioGroup, RadioGroupItem } from '../radio-group/radio-group.tsx';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '../segmented-control/segmented-control.tsx';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../sheet/sheet.tsx';
import { Slider } from '../slider/slider.tsx';
import { DataTable, TableTitle, type DataColumn } from '../table/table.tsx';
import { Tabs, TabsList, TabsTrigger } from '../tabs/tabs.tsx';
import { Text } from '../text/text.tsx';
import { SearchField } from '../typed-fields/typed-fields.tsx';
import { FacetList, FilterGroupEditor, FilterQuery } from './complex-filters.tsx';
import { PEOPLE_FIELDS } from './fields.ts';
import { AppliedFilters, describeFilters, type FilterGroup } from './filter-builder.tsx';

const meta = {
  title: 'Components/Complex filters',
  parameters: designDocs('complex-filters'),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type Person = (typeof PEOPLE)[number];
const COLUMNS: DataColumn<Person>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (p) => <TableTitle title={p.name} description={p.role} avatar={p.name} />,
  },
  { id: 'team', header: 'Team', cell: (p) => p.team },
  { id: 'location', header: 'Location', cell: (p) => p.location },
  {
    id: 'status',
    header: 'Status',
    cell: (p) => (
      <Badge tone={STATUS_TONE[p.status]} size="sm" dot>
        {p.status}
      </Badge>
    ),
  },
];

const APPLIED = [
  { id: 'team', field: 'Team', label: 'Engineering' },
  { id: 'location', field: 'Location', label: 'Berlin or Remote' },
  { id: 'status', field: 'Status', label: 'Active' },
];

function Applied(): React.JSX.Element {
  const [applied, setApplied] = useState(APPLIED);
  return (
    <AppliedFilters
      filters={applied}
      onRemove={(id) => {
        setApplied(applied.filter((f) => f.id !== id));
      }}
    >
      <Chip variant="dashed" icon={SlidersHorizontal} onPress={() => undefined}>
        More filters
      </Chip>
    </AppliedFilters>
  );
}

export const SavedViews: Story = {
  name: 'Saved views',
  render: () => (
    <View className="gap-3">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row items-center gap-1.5">
          <Tabs defaultValue="team">
            <TabsList variant="pill" scroll accessibilityLabel="Saved views">
              <TabsTrigger value="all" count={312}>
                All people
              </TabsTrigger>
              <TabsTrigger value="team" count={12}>
                My team
              </TabsTrigger>
              <TabsTrigger value="new" count={8}>
                New joiners
              </TabsTrigger>
              <TabsTrigger value="leavers" count={4}>
                Leavers
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="ghost" size="sm" startIcon={<Icon icon={BookmarkPlus} />}>
            Save view
          </Button>
        </View>
      </ScrollView>
      <Applied />
      <DataTable
        label="People"
        rows={[0, 1, 8].map((i) => PEOPLE[i] ?? PEOPLE[0])}
        columns={COLUMNS}
        rowId={(p) => p.name}
        onRowPress={() => undefined}
        footer="48 of 312 people"
      />
    </View>
  ),
};

function Facets(): React.JSX.Element {
  const [teams, setTeams] = useState<readonly string[]>(['Engineering']);
  const [places, setPlaces] = useState<readonly string[]>(['Berlin', 'Remote']);
  const [salary, setSalary] = useState([60, 110]);
  const [start, setStart] = useState('year');
  return (
    <View className="gap-5">
      <FacetList
        title="Team"
        selected={teams}
        onSelectedChange={setTeams}
        onShowAll={() => undefined}
        options={[
          { value: 'Engineering', label: 'Engineering', count: 124 },
          { value: 'Sales', label: 'Sales', count: 64 },
          { value: 'Support', label: 'Support', count: 48 },
          { value: 'Design', label: 'Design', count: 28 },
        ]}
      />
      <FacetList
        title="Location"
        selected={places}
        onSelectedChange={setPlaces}
        options={[
          { value: 'Berlin', label: 'Berlin', count: 98 },
          { value: 'London', label: 'London', count: 64 },
          { value: 'Remote', label: 'Remote', count: 82 },
          { value: 'Tokyo', label: 'Tokyo', count: 0 },
        ]}
      />
      <View className="gap-2">
        <Text variant="callout" weight="semibold">
          Salary
        </Text>
        <Slider
          label="Salary"
          thumbLabels={['Minimum salary', 'Maximum salary']}
          min={40}
          max={140}
          value={salary}
          onValueChange={setSalary}
        />
        <View className="flex-row justify-between">
          <CssText className="text-[12px] font-medium text-fg-muted">{`€${String(salary[0])}k`}</CssText>
          <CssText className="text-[12px] font-medium text-fg-muted">{`€${String(salary[1])}k`}</CssText>
        </View>
      </View>
      <View className="gap-2">
        <Text variant="callout" weight="semibold">
          Start date
        </Text>
        <SegmentedControl
          size="sm"
          fullWidth
          value={start}
          onValueChange={setStart}
          accessibilityLabel="Start date"
        >
          <SegmentedControlItem value="any">Any</SegmentedControlItem>
          <SegmentedControlItem value="year">This year</SegmentedControlItem>
          <SegmentedControlItem value="custom">Custom</SegmentedControlItem>
        </SegmentedControl>
      </View>
    </View>
  );
}

export const FacetsWithCounts: Story = {
  name: 'Facets with counts',
  parameters: designNote('complex-filters', 'Facets with counts'),
  play: settled,
  render: () => (
    <Sheet defaultOpen>
      <Stage
        height={760}
        trigger={
          <SheetTrigger asChild>
            <Button size="sm">Filters</Button>
          </SheetTrigger>
        }
      >
        {(host) => (
          <SheetContent portalHost={host}>
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            {/* The facets scroll; the actions stay under the thumb. */}
            <ScrollView className="max-h-[440px]">
              <Facets />
            </ScrollView>
            <SheetFooter>
              <Button>Clear</Button>
              <Button variant="primary">Show 48 people</Button>
            </SheetFooter>
          </SheetContent>
        )}
      </Stage>
    </Sheet>
  ),
};

const POLICY: FilterGroup = {
  match: 'all',
  conditions: [
    { id: 'c1', field: 'team', operator: 'is', values: ['Engineering'] },
    { id: 'c2', field: 'contract', operator: 'is', values: ['Permanent'] },
  ],
  groups: [
    {
      id: 'g1',
      match: 'any',
      conditions: [
        { id: 'c3', field: 'location', operator: 'is', values: ['Berlin'] },
        { id: 'c4', field: 'location', operator: 'is', values: ['Remote'] },
      ],
    },
  ],
};

export const NestedGroups: Story = {
  name: 'Nested and/or groups',
  parameters: designNote('complex-filters', 'Nested and/or groups'),
  render: function NestedStory() {
    const [value, setValue] = useState(POLICY);
    return (
      <Card className="gap-3">
        <Text variant="title3" weight="bold" className="text-[18px]">
          Who should get this policy?
        </Text>
        <FilterGroupEditor fields={PEOPLE_FIELDS} value={value} onChange={setValue} />
        <View className="flex-row flex-wrap items-center gap-2.5">
          <Note>{describeFilters(PEOPLE_FIELDS, value)}</Note>
          <Button variant="primary" size="sm" className="ml-auto">
            Apply · 64 people
          </Button>
        </View>
      </Card>
    );
  },
};

export const RangesAndDates: Story = {
  name: 'Ranges and dates',
  render: function RangesStory() {
    const [preset, setPreset] = useState('custom');
    const [from, setFrom] = useState<string | null>('2024-01-01');
    const [to, setTo] = useState<string | null>('2026-09-30');
    const [tenure, setTenure] = useState([1, 5]);
    return (
      <Card className="gap-5">
        <View className="gap-2.5">
          <Text weight="semibold">Start date</Text>
          <ChipGroup
            type="single"
            value={preset}
            onValueChange={setPreset}
            accessibilityLabel="Start date"
          >
            <ChipGroupItem value="30">Last 30 days</ChipGroupItem>
            <ChipGroupItem value="quarter">This quarter</ChipGroupItem>
            <ChipGroupItem value="year">This year</ChipGroupItem>
            <ChipGroupItem value="custom">Custom</ChipGroupItem>
          </ChipGroup>
          <Field>
            <FieldLabel>From</FieldLabel>
            <DatePicker label="From" locale="en-GB" value={from} onChange={setFrom} />
          </Field>
          <Field>
            <FieldLabel>To</FieldLabel>
            <DatePicker label="To" locale="en-GB" value={to} onChange={setTo} />
          </Field>
        </View>
        <View className="gap-2.5">
          <Text weight="semibold">Tenure</Text>
          <Slider
            label="Tenure, in years"
            thumbLabels={['Least tenure', 'Most tenure']}
            min={0}
            max={10}
            step={1}
            showTicks
            labels={['0', '', '', '', '', '5', '', '', '', '', '10 yrs']}
            value={tenure}
            onValueChange={setTenure}
          />
        </View>
      </Card>
    );
  },
};

const START_SUGGESTIONS = [
  { value: 'start:>2024-01-01', description: 'Joined after a date' },
  { value: 'start:<2024-01-01', description: 'Joined before a date' },
  { value: 'start:2024', description: 'Joined in a year' },
];

export const QuerySyntax: Story = {
  name: 'Query syntax',
  parameters: designNote('complex-filters', 'Query syntax'),
  render: function QueryStory() {
    const [tokens, setTokens] = useState<readonly string[]>(['team:eng', 'location:berlin']);
    const [text, setText] = useState('start:>2024');
    const key = text.split(':')[0] ?? '';
    return (
      <FilterQuery
        tokens={tokens}
        onTokensChange={setTokens}
        text={text}
        onTextChange={setText}
        suggestionsTitle={key === 'start' ? 'start:' : undefined}
        suggestions={key === 'start' ? START_SUGGESTIONS : []}
      />
    );
  },
};

export const SavingAView: Story = {
  name: 'Saving a view',
  play: settled,
  render: function SavingStory() {
    const [name, setName] = useState('Berlin engineers');
    const [who, setWho] = useState('me');
    return (
      <Dialog defaultOpen>
        <Stage
          height={560}
          trigger={
            <DialogTrigger asChild>
              <Button size="sm" startIcon={<Icon icon={BookmarkPlus} />}>
                Save view
              </Button>
            </DialogTrigger>
          }
        >
          {(host) => (
            <DialogContent portalHost={host}>
              <DialogHeader>
                <DialogTitle>Save this view</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <Field>
                  <FieldLabel>Name</FieldLabel>
                  <Input value={name} onChange={setName} />
                </Field>
                <RadioGroup value={who} onValueChange={setWho} accessibilityLabel="Who sees it">
                  <RadioGroupItem value="me">Only me</RadioGroupItem>
                  <RadioGroupItem value="team">Everyone in People team</RadioGroupItem>
                </RadioGroup>
                <Note>Saves 3 filters and the Name A–Z sort.</Note>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button>Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="primary">Save view</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          )}
        </Stage>
      </Dialog>
    );
  },
};

export const ZeroResults: Story = {
  name: 'Zero results, with a way out',
  render: () => (
    <Card>
      <EmptyState
        icon={SearchX}
        title="No one matches all 4 filters"
        description="The Tokyo filter removes everyone. Try one of these:"
        className="py-3"
        action={
          <>
            <Chip icon={X} onPress={() => undefined}>
              Remove Tokyo · 48
            </Chip>
            <Chip icon={X} onPress={() => undefined}>
              Remove Active · 3
            </Chip>
            <Button variant="ghost" size="sm">
              Clear all
            </Button>
          </>
        }
      />
    </Card>
  ),
};

export const FilterSheet: Story = {
  name: 'Filter sheet',
  play: settled,
  render: function SheetStory() {
    const [query, setQuery] = useState('');
    return (
      <Sheet defaultOpen>
        <Stage
          height={640}
          trigger={
            <SheetTrigger asChild>
              <Button size="sm" startIcon={<Icon icon={SlidersHorizontal} />}>
                Filters
              </Button>
            </SheetTrigger>
          }
        >
          {(host) => (
            <SheetContent portalHost={host}>
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
              </SheetHeader>
              <View className="gap-3.5">
                <SearchField
                  size="sm"
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search filters"
                  label="Search filters"
                />
                <List>
                  {(
                    [
                      ['Team', 'Engineering'],
                      ['Location', '2 selected'],
                      ['Status', 'Active'],
                      ['Start date', ''],
                      ['Manager', ''],
                      ['Contract', ''],
                    ] as const
                  ).map(([field, chosen]) => (
                    <ListItem
                      key={field}
                      onPress={() => undefined}
                      className="min-h-[52px]"
                      trailing={
                        <>
                          {chosen ? (
                            <CssText className="text-[15px] text-fg-muted">{chosen}</CssText>
                          ) : null}
                          <Icon icon={ChevronRight} size={16} tone="subtle" />
                        </>
                      }
                    >
                      {field}
                    </ListItem>
                  ))}
                </List>
                <Button variant="primary" fullWidth>
                  Show 48 people
                </Button>
              </View>
            </SheetContent>
          )}
        </Stage>
      </Sheet>
    );
  },
};
