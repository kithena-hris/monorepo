import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Check, Plus, RotateCw, Users, WifiOff, X } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { AppBar } from '../components/app-bar/app-bar.tsx';
import { Avatar } from '../components/avatar/avatar.tsx';
import { Badge } from '../components/badge/badge.tsx';
import { Button } from '../components/button/button.tsx';
import { Card } from '../components/card/card.tsx';
import { BarChart } from '../components/chart/bar-chart.tsx';
import { DonutChart } from '../components/chart/distribution-chart.tsx';
import { ChartCard } from '../components/chart/parts.tsx';
import { Sparkline } from '../components/chart/trend-chart.tsx';
import { Chip } from '../components/chip/chip.tsx';
import { Combobox } from '../components/combobox/combobox.tsx';
import { DatePicker } from '../components/date-picker/date-picker.tsx';
import { Dialog, DialogClose, DialogContent } from '../components/dialog/dialog.tsx';
import { EmptyState, Skeleton } from '../components/feedback/feedback.tsx';
import { Field, FieldLabel } from '../components/field/field.tsx';
import {
  AppliedFilters,
  type AppliedFilter,
} from '../components/filter-builder/filter-builder.tsx';
import { Icon } from '../components/icon/icon.tsx';
import { KeyValues } from '../components/key-values/key-values.tsx';
import { AutoGrid, Inline, Stack } from '../components/layout/layout.tsx';
import { List, ListItem } from '../components/list-item/list-item.tsx';
import { Money } from '../components/money/money.tsx';
import { Pagination } from '../components/pagination/pagination.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select/select.tsx';
import { Stat } from '../components/stat/stat.tsx';
import { DataTable, TableTitle, type DataColumn } from '../components/table/table.tsx';
import { Text } from '../components/text/text.tsx';
import { SearchField } from '../components/typed-fields/typed-fields.tsx';
import { byMonth, HIRES, MONTHS } from '../docs/charts.ts';
import { designDocs, designNote } from '../docs/design.ts';
import { Note } from '../docs/notes.tsx';
import { PEOPLE, STATUS_TONE } from '../docs/people.ts';

/*
 * Whole screens that combine components, composed only from the library:
 * the directory, filters, the infinite list, the dashboard, the approval
 * queue, and the three states a list is in when it is not a list.
 */

const meta = {
  title: 'Foundations/Patterns',
  parameters: designDocs('patterns'),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type Person = (typeof PEOPLE)[number];

/** The directory's columns. On a phone each row is a card: the name, then the rest. */
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
  { id: 'start', header: 'Start date', cell: (p) => p.start },
];

const APPLIED: readonly AppliedFilter[] = [
  { id: 'team', field: 'Team', label: 'Engineering' },
  { id: 'location', field: 'Location', label: 'Berlin' },
];

const open = (): void => undefined;

/** The search, the applied filters as chips, and the way to add one. */
function FilterBar(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState(APPLIED);
  return (
    <Stack gap={2} className="w-full">
      <SearchField
        size="sm"
        value={query}
        onValueChange={setQuery}
        placeholder="Search people"
        label="Search people"
      />
      <AppliedFilters
        filters={applied}
        onRemove={(id) => {
          setApplied(applied.filter((f) => f.id !== id));
        }}
      >
        <Chip variant="dashed" icon={Plus} onPress={open}>
          Add filter
        </Chip>
      </AppliedFilters>
    </Stack>
  );
}

function Directory(): React.JSX.Element {
  const [page, setPage] = useState(1);
  return (
    <DataTable
      label="People"
      rows={PEOPLE.slice(0, 6)}
      columns={COLUMNS}
      rowId={(p) => p.name}
      onRowPress={open}
      toolbar={<FilterBar />}
      footer={<Pagination page={page} pageCount={52} onPageChange={setPage} className="flex-1" />}
    />
  );
}

export const PeopleDirectory: Story = {
  name: 'People directory',
  render: () => <Directory />,
};

const TEAMS = ['Engineering', 'Design', 'Sales', 'Finance', 'Support'].map((t) => ({
  value: t,
  label: t,
}));

function Filters(): React.JSX.Element {
  const [teams, setTeams] = useState<readonly string[]>(['Engineering', 'Design']);
  const [after, setAfter] = useState<string | null>('2024-01-01');
  const [status, setStatus] = useState('active');
  return (
    <Stack gap={4}>
      <Card className="gap-3.5">
        <Text variant="title3" weight="bold" accessibilityRole="header">
          Filters
        </Text>
        <Field>
          <FieldLabel>Team</FieldLabel>
          <Combobox
            label="Team"
            multiple
            options={TEAMS}
            value={teams}
            onChange={(value) => {
              setTeams(Array.isArray(value) ? value : []);
            }}
          />
        </Field>
        <Field>
          <FieldLabel>Start date</FieldLabel>
          <DatePicker
            label="Start date"
            locale="en-GB"
            value={after}
            onChange={setAfter}
            today="2026-10-01"
          />
        </Field>
        <Field>
          <FieldLabel>Status</FieldLabel>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="leave">On leave</SelectItem>
              <SelectItem value="onboarding">Onboarding</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Inline gap={2} justify="end">
          <Button
            variant="ghost"
            size="sm"
            onPress={() => {
              setTeams([]);
              setAfter(null);
            }}
          >
            Clear
          </Button>
          <Button variant="primary" size="sm">
            Show 48 people
          </Button>
        </Inline>
      </Card>
      <FilterBar />
      <Note>
        Applied filters show as chips above the results. Removing a chip updates the results
        straight away.
      </Note>
    </Stack>
  );
}

export const AdvancedFilters: Story = {
  name: 'Advanced filters',
  render: () => <Filters />,
};

function Infinite(): React.JSX.Element {
  const [rows, setRows] = useState<Person[]>(PEOPLE.slice(0, 4));
  const more = rows.length < PEOPLE.length;
  return (
    <DataTable
      label="People"
      rows={rows}
      columns={COLUMNS}
      rowId={(p) => p.name}
      onRowPress={open}
      loadingMore={more}
      onEndReached={() => {
        if (more) setRows(PEOPLE.slice(0, rows.length + 4));
      }}
    />
  );
}

export const InfiniteScrollingTable: Story = {
  name: 'Infinite scrolling table',
  parameters: designNote('patterns', 'Infinite scrolling table'),
  render: () => <Infinite />,
};

export const AnalyticsDashboard: Story = {
  name: 'Analytics dashboard',
  render: () => (
    <Stack gap={3}>
      <AutoGrid minItemWidth={150} gap={3}>
        <Stat
          label="Headcount"
          value="312"
          delta="+12 this quarter"
          direction="up"
          sentiment="positive"
          size={28}
          chart={
            <Sparkline
              label="Headcount, last seven months"
              data={[280, 286, 290, 297, 301, 306, 312].map((v, i) => ({
                label: MONTHS[i + 2] ?? '',
                value: v,
              }))}
              tone="success"
              area={false}
              showLastPoint={false}
              width={88}
              height={24}
            />
          }
        />
        <Stat
          label="Attrition"
          value="6.1"
          unit="%"
          delta="0.8 pts lower"
          direction="down"
          sentiment="positive"
          size={28}
        />
        <Stat
          label="Time to hire"
          value="24"
          unit="days"
          delta="3 days faster"
          direction="down"
          sentiment="positive"
          size={28}
        />
        <Stat label="Open roles" value="18" direction="up" delta="4 more than Q2" sentiment="negative" size={28} />
      </AutoGrid>
      <ChartCard title="Hires by month" value="82">
        <BarChart
          label="Hires by month, 2026"
          summary="82 hires in 2026. The most was 14 in September."
          data={byMonth(HIRES.slice(0, 9))}
          highlightIndex={8}
        />
      </ChartCard>
      <ChartCard title="Headcount by team">
        <DonutChart
          label="Headcount by team"
          size={130}
          centerLabel="people"
          data={[
            { label: 'Engineering', value: 124 },
            { label: 'Sales', value: 64 },
            { label: 'Support', value: 48 },
            { label: 'Design', value: 28 },
            { label: 'Other', value: 48 },
          ]}
        />
      </ChartCard>
    </Stack>
  ),
};

type Request = {
  name: string;
  role: string;
  kind: string;
  detail: React.ReactNode;
  when: string;
  facts: readonly { label: string; value: React.ReactNode }[];
};

const REQUESTS: readonly Request[] = [
  {
    name: 'Amara Okafor',
    role: 'Product Designer · Design',
    kind: 'Vacation',
    detail: 'Vacation · 5 days',
    when: '12m',
    facts: [
      { label: 'Type', value: 'Vacation' },
      { label: 'Dates', value: '14–18 Oct' },
      { label: 'Days', value: '5 of 14.5 left' },
      { label: 'Cover', value: 'Omar Haddad' },
    ],
  },
  {
    name: 'Mei Tanaka',
    role: 'Data Analyst · Finance',
    kind: 'Expense',
    detail: (
      <Text variant="subhead" tone="muted">
        {'Expense · '}
        <Money minorUnits="24800" currency="EUR" className="text-fg-muted" />
      </Text>
    ),
    when: '1h',
    facts: [
      { label: 'Type', value: 'Expense' },
      { label: 'Amount', value: <Money minorUnits="24800" currency="EUR" /> },
      { label: 'For', value: 'Team offsite, travel' },
    ],
  },
  {
    name: 'Lucas Moreau',
    role: 'Account Executive · Sales',
    kind: 'Equipment',
    detail: 'Equipment · Laptop',
    when: 'Yesterday',
    facts: [
      { label: 'Type', value: 'Equipment' },
      { label: 'Item', value: 'Laptop' },
    ],
  },
  {
    name: 'Tom Fischer',
    role: 'Sales Manager · Sales',
    kind: 'Vacation',
    detail: 'Vacation · 2 days',
    when: 'Mon',
    facts: [
      { label: 'Type', value: 'Vacation' },
      { label: 'Dates', value: '24–25 Oct' },
    ],
  },
];

function Queue(): React.JSX.Element {
  const [opened, setOpened] = useState<Request | null>(null);
  const [done, setDone] = useState<readonly string[]>([]);
  const waiting = REQUESTS.filter((r) => !done.includes(r.name));
  const settle = (): void => {
    if (opened) setDone([...done, opened.name]);
    setOpened(null);
  };
  return (
    <Dialog
      open={opened !== null}
      onOpenChange={(next) => {
        if (!next) setOpened(null);
      }}
    >
      {waiting.length > 0 ? (
        <List>
          {waiting.map((request, i) => (
            <ListItem
              key={request.name}
              leading={<Avatar name={request.name} size={36} decorative />}
              description={request.detail}
              trailing={
                <Text variant="caption" weight="regular" tone="subtle">
                  {request.when}
                </Text>
              }
              selected={i === 0}
              onPress={() => {
                setOpened(request);
              }}
            >
              {request.name}
            </ListItem>
          ))}
        </List>
      ) : (
        <Card>
          <EmptyState icon={Check} tone="accent" title="All caught up" />
        </Card>
      )}
      {/* Full screen, with Approve and Decline pinned at the bottom. */}
      <DialogContent size="full" label={opened ? `${opened.kind} from ${opened.name}` : 'Request'}>
        {opened ? (
          <View className="flex-1">
            <AppBar
              title={opened.kind}
              leading={
                <DialogClose asChild>
                  <Button
                    size="xs"
                    variant="secondary"
                    startIcon={<Icon icon={X} />}
                    accessibilityLabel="Close"
                  />
                </DialogClose>
              }
            />
            <Stack gap={4} className="flex-1 px-4 pt-2">
              <Inline gap={3} wrap={false} className="items-center">
                <Avatar name={opened.name} size="xl" decorative />
                <Stack gap={0}>
                  <Text variant="headline">{opened.name}</Text>
                  <Text variant="subhead" tone="muted">
                    {opened.role}
                  </Text>
                </Stack>
              </Inline>
              <Card className="py-2.5">
                <KeyValues items={opened.facts} />
              </Card>
            </Stack>
            <Inline gap={2} wrap={false} className="px-4 pb-6">
              <Button className="flex-1" fullWidth onPress={settle}>
                Decline
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                fullWidth
                startIcon={<Icon icon={Check} />}
                onPress={settle}
              >
                Approve
              </Button>
            </Inline>
          </View>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export const ApprovalQueue: Story = {
  name: 'Approval queue',
  parameters: designNote('patterns', 'Approval queue'),
  render: () => <Queue />,
};

export const LoadingEmptyAndFailure: Story = {
  name: 'Loading, empty and failure',
  render: () => (
    <Stack gap={3}>
      <Card>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Loading people"
          className="gap-2.5"
        >
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-4/5" />
          <Skeleton className="h-2.5 w-[90%]" />
        </View>
      </Card>
      <Card>
        <EmptyState
          className="py-2"
          icon={Users}
          title="No one here yet"
          description="Invite your team to see them in the directory."
          action={
            <Button variant="primary" size="sm">
              Invite people
            </Button>
          }
        />
      </Card>
      <Card>
        <EmptyState
          className="py-2"
          icon={WifiOff}
          tone="danger"
          title="Couldn’t load people"
          description="Check your connection. Nothing was lost."
          action={
            <Button size="sm" startIcon={<Icon icon={RotateCw} />}>
              Try again
            </Button>
          }
        />
      </Card>
    </Stack>
  ),
};
