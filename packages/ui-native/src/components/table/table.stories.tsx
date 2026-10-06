import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Columns3, Download, Info, Plus, SearchX } from 'lucide-react-native';
import { useState } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { designDocs, designNote } from '../../docs/design.ts';
import { Note } from '../../docs/notes.tsx';
import { PEOPLE, STATUS_TONE } from '../../docs/people.ts';
import { move } from '../../lib/reorder.tsx';
import { Badge } from '../badge/badge.tsx';
import { Button } from '../button/button.tsx';
import { Chip } from '../chip/chip.tsx';
import { Alert, EmptyState } from '../feedback/feedback.tsx';
import { Icon } from '../icon/icon.tsx';
import { KeyValues } from '../key-values/key-values.tsx';
import { Pagination } from '../pagination/pagination.tsx';
import { Money } from '../money/money.tsx';
import { Text } from '../text/text.tsx';
import { SearchField } from '../typed-fields/typed-fields.tsx';
import { Avatar } from '../avatar/avatar.tsx';
import {
  BulkAction,
  DataTable,
  TableTitle,
  type DataColumn,
  type DataTableProps,
} from './table.tsx';

type Person = (typeof PEOPLE)[number];

const status = (p: Person): React.JSX.Element => (
  <Badge tone={STATUS_TONE[p.status]} size="sm" dot>
    {p.status}
  </Badge>
);

/** The directory's columns: the name is the card's title, the start date stays off the card. */
const COLUMNS: DataColumn<Person>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (p) => <TableTitle title={p.name} description={p.role} avatar={p.name} />,
    sortBy: (p) => p.name,
  },
  { id: 'team', header: 'Team', cell: (p) => p.team, sortBy: (p) => p.team },
  { id: 'location', header: 'Location', cell: (p) => p.location, sortBy: (p) => p.location },
  { id: 'status', header: 'Status', cell: status },
  {
    id: 'start',
    header: 'Start date',
    cell: (p) => p.start,
    hideOnCard: true,
    sortBy: (p) => Date.parse(p.start),
  },
];

const open = (): void => undefined;

const meta: Meta<DataTableProps<Person>> = {
  title: 'Components/Table',
  component: DataTable,
  parameters: {
    ...designDocs('table'),
    controls: { exclude: ['rows', 'columns', 'rowId'] },
  },
};

export default meta;
type Story = StoryObj<DataTableProps<Person>>;

const id = (p: Person): string => p.name;

export const Directory: Story = {
  render: () => (
    <DataTable
      label="People"
      rows={PEOPLE.slice(0, 6)}
      columns={COLUMNS}
      rowId={id}
      onRowPress={open}
    />
  ),
};

const FTE = ['1.0', '1.0', '0.8', '1.0', '0.6', '1.0'];
const BONUS = [460_000, 800_000, 0, 355_000, 120_000, 0];
const CHANGE = [
  ['+4.5%', 'success'],
  ['+6.0%', 'success'],
  ['—', 'muted'],
  ['+3.0%', 'success'],
  ['−2.0%', 'danger'],
  ['—', 'muted'],
] as const;
const CHANGE_TONE = { success: 'text-success-fg', danger: 'text-danger-fg', muted: 'text-fg-subtle' };

type Paid = Person & { index: number };
const PAID: Paid[] = PEOPLE.slice(0, 6).map((p, index) => ({ ...p, index }));

const MONEY_COLUMNS: DataColumn<Paid>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (p) => <TableTitle title={p.name} description={p.role} avatar={p.name} />,
  },
  { id: 'team', header: 'Team', cell: (p) => p.team },
  { id: 'fte', header: 'FTE', numeric: true, cell: (p) => FTE[p.index] ?? '' },
  {
    id: 'salary',
    header: 'Base salary',
    numeric: true,
    cardTrailing: true,
    cell: (p) => <Money minorUnits={String(p.salary)} currency="EUR" locale="en-GB" />,
  },
  {
    id: 'bonus',
    header: 'Bonus',
    numeric: true,
    cell: (p) => (
      <Money minorUnits={String(BONUS[p.index] ?? 0)} currency="EUR" locale="en-GB" />
    ),
  },
  {
    id: 'change',
    header: 'Change',
    numeric: true,
    cell: (p) => {
      const [text, tone] = CHANGE[p.index] ?? ['—', 'muted'];
      return (
        <CssText className={`text-[14px] leading-[1.3] tabular-nums ${CHANGE_TONE[tone]}`}>
          {text}
        </CssText>
      );
    },
  },
];

export const NumericAlignment: Story = {
  name: 'Numeric alignment',
  parameters: designNote('table', 'Numeric alignment'),
  render: () => (
    <DataTable
      label="Pay"
      rows={PAID}
      columns={MONEY_COLUMNS}
      rowId={(p) => p.name}
      labelled
      onRowPress={open}
      footer={
        <>
          <CssText className="text-[14px] leading-[1.3] text-fg-muted">Totals</CssText>
          <CssText className="text-[13px] leading-none font-semibold text-fg tabular-nums">
            {/* Summed in the domain; the table only shows the result. */}
            <Money minorUnits="52100000" currency="EUR" locale="en-GB" className="text-[13px]" />
            {' · '}
            <Money minorUnits="1735000" currency="EUR" locale="en-GB" className="text-[13px]" />
          </CssText>
        </>
      }
    />
  ),
};

export const InteractiveRows: Story = {
  name: 'Interactive rows',
  parameters: designNote('table', 'Interactive rows'),
  render: function InteractiveStory() {
    const [opened, setOpened] = useState<string | null>(null);
    return (
      <View className="gap-2">
        <DataTable
          label="People"
          rows={PEOPLE.slice(0, 5)}
          columns={COLUMNS}
          rowId={id}
          onRowPress={(p) => {
            setOpened(p.name);
          }}
        />
        {opened ? <Note>{`Opened ${opened}`}</Note> : null}
      </View>
    );
  },
};

export const Loading: Story = {
  render: () => <DataTable label="People" rows={[]} columns={COLUMNS} rowId={id} loading />,
};

function Toolbar(): React.JSX.Element {
  const [query, setQuery] = useState('');
  return (
    <>
      <View className="w-full">
        <SearchField
          size="sm"
          value={query}
          onValueChange={setQuery}
          placeholder="Search people"
          label="Search people"
        />
      </View>
      <Chip field="Team" selected onRemove={() => undefined}>
        Engineering
      </Chip>
      <Chip variant="dashed" icon={Plus} onPress={() => undefined}>
        Filter
      </Chip>
    </>
  );
}

export const Empty: Story = {
  render: () => (
    <DataTable
      label="People"
      rows={[]}
      columns={COLUMNS}
      rowId={id}
      toolbar={<Toolbar />}
      empty={
        <EmptyState
          icon={SearchX}
          title={'No one matches "Priyaa"'}
          description="Check the spelling, or clear the Engineering filter."
          action={
            <Button variant="secondary" size="sm">
              Clear filters
            </Button>
          }
        />
      }
    />
  ),
};

export const Expandable: Story = {
  name: 'DataTable: expandable rows',
  render: () => (
    <DataTable
      label="People"
      rows={PEOPLE.slice(0, 5)}
      columns={COLUMNS}
      rowId={id}
      defaultExpanded={['Jonas Weber']}
      renderDetail={() => (
        <KeyValues
          items={[
            { label: 'Manager', value: 'Nora Becker' },
            { label: 'Reports', value: '6 people' },
            { label: 'Email', value: 'jonas@reach.co' },
            { label: 'Phone', value: '+49 151 000 1122' },
          ]}
        />
      )}
    />
  ),
};

const bulk = (): React.JSX.Element => (
  <>
    <BulkAction>Message</BulkAction>
    <BulkAction>Export</BulkAction>
  </>
);

export const Selection: Story = {
  name: 'DataTable: selection and bulk actions',
  render: () => (
    <DataTable
      label="People"
      rows={PEOPLE.slice(0, 6)}
      columns={COLUMNS}
      rowId={id}
      onRowPress={open}
      selectable
      defaultSelected={['Priya Shah', 'Amara Okafor', 'Lucas Moreau']}
      bulkActions={bulk}
    />
  ),
};

export const Sorting: Story = {
  name: 'DataTable: sorting',
  parameters: designNote('table', 'DataTable: sorting'),
  render: () => (
    <DataTable
      label="People"
      rows={[1, 0, 8, 9, 2, 3].map((i) => PEOPLE[i] ?? PEOPLE[0])}
      columns={COLUMNS}
      rowId={id}
      onRowPress={open}
      defaultSort={[
        { columnId: 'team', direction: 'ascending' },
        { columnId: 'start', direction: 'descending' },
      ]}
    />
  ),
};

type Task = { title: string; owner: Person; team: string; due: string };
const TASKS: Task[] = [
  ['Renew Berlin office lease', 7, 'People', '30 Sep'],
  ['Q4 salary review', 11, 'Finance', '15 Oct'],
  ['Launch mentoring', 6, 'People', '1 Nov'],
  ['Migrate payroll', 1, 'Engineering', '1 Dec'],
].map(([title, owner, team, due]) => ({
  title: String(title),
  owner: PEOPLE[Number(owner)] ?? PEOPLE[0],
  team: String(team),
  due: String(due),
}));

const TASK_COLUMNS: DataColumn<Task>[] = [
  { id: 'priority', header: 'Priority', cell: (t) => t.title },
  {
    id: 'owner',
    header: 'Owner',
    cell: (t) => (
      <TableTitle
        title={t.owner.name}
        description={t.team}
        leading={<Avatar name={t.owner.name} size={28} decorative />}
      />
    ),
  },
  { id: 'due', header: 'Due', cell: (t) => t.due },
];

export const Reorderable: Story = {
  name: 'DataTable: drag to reorder',
  render: function ReorderStory() {
    const [tasks, setTasks] = useState(TASKS);
    return (
      <DataTable
        label="Priorities"
        rows={tasks}
        columns={TASK_COLUMNS}
        rowId={(t) => t.title}
        onRowPress={() => undefined}
        onReorder={({ from, to }) => {
          setTasks(move(tasks, from, to));
        }}
      />
    );
  },
};

function Everything(): React.JSX.Element {
  const [page, setPage] = useState(1);
  return (
    <DataTable
      label="People"
      rows={PEOPLE.slice(0, 6)}
      columns={COLUMNS}
      rowId={id}
      toolbar={
        <>
          <Toolbar />
          <View className="ml-auto flex-row gap-2">
            <Button variant="secondary" size="sm" startIcon={<Icon icon={Columns3} />}>
              Columns
            </Button>
            <Button variant="secondary" size="sm" startIcon={<Icon icon={Download} />}>
              Export
            </Button>
          </View>
        </>
      }
      selectable
      defaultSelected={['Jonas Weber', 'Mei Tanaka']}
      bulkActions={bulk}
      defaultExpanded={['Mei Tanaka']}
      renderDetail={(p) => <Note>{`${p.name} · ${p.role} · reports to Zara Ahmed`}</Note>}
      footer={<Pagination page={page} pageCount={52} onPageChange={setPage} className="flex-1" />}
    />
  );
}

export const AllOfIt: Story = {
  name: 'DataTable, all of it at once',
  render: () => <Everything />,
};

export const OnAPhone: Story = {
  name: 'DataTable, on a phone',
  render: function PhoneStory() {
    const [query, setQuery] = useState('');
    return (
      <DataTable
        label="People"
        rows={PEOPLE.slice(0, 5)}
        columns={COLUMNS}
        rowId={id}
        onRowPress={open}
        selectable
        defaultSelected={['Jonas Weber']}
        bulkActions={bulk}
        toolbar={
          <View className="w-full">
            <SearchField
              size="sm"
              value={query}
              onValueChange={setQuery}
              placeholder="Search"
              label="Search people"
            />
          </View>
        }
      />
    );
  },
};

/** Twenty thousand people, numbered. */
type Numbered = Person & { n: number };
const MANY: Numbered[] = Array.from({ length: 20_000 }, (_, n) => ({
  ...(PEOPLE[n % PEOPLE.length] ?? PEOPLE[0]),
  n,
}));
const count = new Intl.NumberFormat('en-GB');

const MANY_COLUMNS: DataColumn<Numbered>[] = [
  {
    id: 'person',
    header: 'Person',
    sortBy: (p) => p.name,
    cell: (p) => (
      <TableTitle
        title={p.name}
        description={p.team}
        leading={
          <View className="flex-row items-center gap-3">
            <Text mono className="w-[54px] text-[12px] leading-none font-medium text-fg-subtle">
              {`#${count.format(p.n + 1)}`}
            </Text>
            <Avatar name={p.name} size={40} decorative />
          </View>
        }
      />
    ),
  },
  { id: 'location', header: 'Location', cell: (p) => p.location },
  { id: 'status', header: 'Status', cell: status },
  { id: 'start', header: 'Start date', cell: (p) => p.start, hideOnCard: true },
];

export const Virtualized: Story = {
  render: () => (
    <DataTable
      label="Everyone"
      rows={MANY.slice(18_200).concat(MANY.slice(0, 18_200))}
      columns={MANY_COLUMNS}
      rowId={(p) => String(p.n)}
      onRowPress={open}
      virtualHeight={480}
      footer="Rendering 12 of 20,000"
    />
  ),
};

/** The next six people. */
const page = (from: number): Numbered[] => MANY.slice(from, from + 6);

export const Infinite: Story = {
  name: 'Infinite, striped, resizable',
  render: function InfiniteStory() {
    const [rows, setRows] = useState<Numbered[]>(page(0));
    return (
      <DataTable
        label="People"
        rows={rows}
        columns={COLUMNS.slice(0, 4)}
        rowId={(p) => String(p.n)}
        onRowPress={open}
        striped
        loadingMore={rows.length < 60}
        onEndReached={() => {
          setRows([...rows, ...page(rows.length)]);
        }}
      />
    );
  },
};

export const Grouped: Story = {
  render: () => (
    <DataTable
      label="Pay by team"
      rows={[0, 1, 8, 9, 2, 3, 10].map((i, index) => ({ ...(PEOPLE[i] ?? PEOPLE[0]), index }))}
      columns={[
        MONEY_COLUMNS[0] as DataColumn<Paid>,
        { id: 'location', header: 'Location', cell: (p) => p.location },
        {
          id: 'fte',
          header: 'FTE',
          numeric: true,
          cell: (p) => (p.team === 'Design' ? '0.8' : '1.0'),
        },
        MONEY_COLUMNS[3] as DataColumn<Paid>,
      ]}
      rowId={(p) => p.name}
      onRowPress={open}
      groupBy={(p) => p.team}
      defaultCollapsedGroups={['Sales']}
    />
  ),
};

export const VirtualizedSorted: Story = {
  name: 'Virtualized, sorted',
  render: () => (
    <DataTable
      label="Everyone"
      rows={MANY}
      columns={MANY_COLUMNS}
      rowId={(p) => String(p.n)}
      onRowPress={open}
      virtualHeight={440}
      sortedOutside
      defaultSort={[{ columnId: 'person', direction: 'ascending' }]}
      footer="Sorted 20,000 rows on the server in 180 ms"
    />
  ),
};

export const VirtualizedSelection: Story = {
  name: 'Virtualized, selection',
  render: () => (
    <DataTable
      label="Everyone"
      rows={MANY.slice(4000).concat(MANY.slice(0, 4000))}
      columns={MANY_COLUMNS}
      rowId={(p) => String(p.n)}
      onRowPress={open}
      virtualHeight={400}
      selectable
      total={20_000}
      defaultSelected={MANY.map((p) => String(p.n))}
      bulkActions={() => (
        <>
          <BulkAction>Export</BulkAction>
          <BulkAction>Message</BulkAction>
        </>
      )}
      footer="Select all picks every row that matches, not just the rows on screen."
    />
  ),
};

export const VirtualizationOff: Story = {
  name: 'Virtualization off',
  render: () => (
    <View className="gap-2.5">
      <Alert tone="info" icon={Info} title={'Under 200 rows? Don’t virtualize.'}>
        Plain rows let ⌘F, printing and screen readers work properly.
      </Alert>
      <DataTable
        label="People"
        rows={PEOPLE.slice(0, 4)}
        columns={COLUMNS}
        rowId={id}
        onRowPress={open}
        footer="All 4 rows rendered"
      />
    </View>
  ),
};
