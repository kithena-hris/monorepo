import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useRef, useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Checkbox } from '../checkbox/checkbox';
import { EmptyState, Skeleton } from '../feedback/feedback';
import { KeyValues } from '../key-values/key-values';
import { Money } from '../money/money';
import { Button } from '../button/button';
import { DataTable, type DataColumn, type DataTableHandle } from './data-table';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

interface Row {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'on-leave' | 'offboarding';
  hiredOn: string;
  salaryMinorUnits: string;
}

const rows: Row[] = [
  {
    id: 'EMP-004182',
    name: 'Grace Hopper',
    role: 'Principal Engineer',
    status: 'active',
    hiredOn: '2019-04-01',
    salaryMinorUnits: '1420000',
  },
  {
    id: 'EMP-004310',
    name: 'Ada Lovelace',
    role: 'Staff Engineer',
    status: 'on-leave',
    hiredOn: '2021-01-18',
    salaryMinorUnits: '1285000',
  },
  {
    id: 'EMP-004977',
    name: 'Radia Perlman',
    role: 'Engineering Manager',
    status: 'active',
    hiredOn: '2022-11-07',
    salaryMinorUnits: '1360000',
  },
  {
    id: 'EMP-005204',
    name: 'Katherine Johnson',
    role: 'Data Analyst',
    status: 'offboarding',
    hiredOn: '2024-06-03',
    salaryMinorUnits: '890000',
  },
];

const statusTone = {
  active: 'success',
  'on-leave': 'warning',
  offboarding: 'neutral',
} as const;

const statusLabel = {
  active: 'Active',
  'on-leave': 'On leave',
  offboarding: 'Offboarding',
} as const;

/** A wider cast for the stories that need teams, places and a salary to add up. */
interface Person {
  id: string;
  name: string;
  team: string;
  location: string;
  status: 'Active' | 'On leave' | 'Onboarding' | 'Offboarding' | 'Invited';
  start: string;
  fte: string;
  salaryMinorUnits: string;
  bonusMinorUnits: string;
  change: string;
}

const people: Person[] = [
  ['Priya Shah', 'Engineering', 'Berlin', 'Active', '2024-09-02', '1.0', 92000, 4600, '+4.5%'],
  ['Jonas Weber', 'Engineering', 'Berlin', 'Active', '2021-01-14', '1.0', 118000, 8000, '+6.0%'],
  ['Amara Okafor', 'Design', 'London', 'On leave', '2022-06-20', '0.8', 84000, 0, '—'],
  ['Lucas Moreau', 'Sales', 'Paris', 'Onboarding', '2026-09-21', '1.0', 71000, 3550, '+3.0%'],
  ['Mei Tanaka', 'Finance', 'Remote', 'Active', '2023-03-06', '0.6', 78000, 1200, '−2.0%'],
  ['Diego Alvarez', 'Support', 'Madrid', 'Offboarding', '2020-11-02', '1.0', 66000, 0, '—'],
  ['Sofia Lindqvist', 'People', 'Stockholm', 'Active', '2025-02-10', '1.0', 69000, 0, '—'],
  ['Nora Becker', 'People', 'Berlin', 'Active', '2019-04-01', '1.0', 124000, 0, '—'],
  ['Omar Haddad', 'Engineering', 'Remote', 'Active', '2023-07-18', '1.0', 88000, 0, '—'],
  ['Yuki Sato', 'Engineering', 'Tokyo', 'Invited', '2026-10-01', '1.0', 90000, 0, '—'],
  ['Tom Fischer', 'Sales', 'Munich', 'Active', '2022-05-09', '1.0', 97000, 0, '—'],
  ['Zara Ahmed', 'Finance', 'London', 'Active', '2021-08-03', '1.0', 109000, 0, '—'],
].map(([name, team, location, status, start, fte, salary, bonus, change], index) => ({
  id: `P-${String(index + 1).padStart(3, '0')}`,
  name: String(name),
  team: String(team),
  location: String(location),
  status: status as Person['status'],
  start: String(start),
  fte: String(fte),
  salaryMinorUnits: `${String(salary)}00`,
  bonusMinorUnits: `${String(bonus)}00`,
  change: String(change),
}));

const personTone = {
  Active: 'success',
  'On leave': 'warning',
  Onboarding: 'info',
  Offboarding: 'neutral',
  Invited: 'accent',
} as const;

const shortDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const personName: DataColumn<Person> = {
  id: 'name',
  header: 'Name',
  sortBy: (p) => p.name,
  cell: (p) => (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar size="sm" name={p.name} />
      <span className="truncate font-semibold">{p.name}</span>
    </span>
  ),
};

const personColumns: DataColumn<Person>[] = [
  personName,
  { id: 'team', header: 'Team', sortBy: (p) => p.team, cell: (p) => p.team },
  { id: 'location', header: 'Location', sortBy: (p) => p.location, cell: (p) => p.location },
  {
    id: 'status',
    header: 'Status',
    width: '8rem',
    cell: (p) => (
      <Badge dot size="sm" tone={personTone[p.status]}>
        {p.status}
      </Badge>
    ),
  },
  {
    id: 'start',
    header: 'Start date',
    shortHeader: 'Started',
    width: '8rem',
    sortBy: (p) => p.start,
    cell: (p) => (
      <time dateTime={p.start} className="text-fg-muted">
        {shortDate.format(new Date(p.start))}
      </time>
    ),
  },
];

/** Adds minor-unit strings without leaving integers: money is never a float. */
const sumMinor = (values: readonly string[]): string =>
  values.reduce((total, value) => total + BigInt(value), 0n).toString();

const meta = {
  title: 'Components/Table',
  component: Table,
  subcomponents: {
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
    TableFooter,
    /*
     * An instantiation expression, not a cast. `DataTable` is generic and
     * Storybook's `subcomponents` map wants a plain component, so the generic
     * has to be pinned to *something*; naming the `Row` type this file already
     * uses pins it to the one the props table should document, where `as never`
     * threw the props away entirely.
     */
    DataTable: DataTable<Row>,
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Tabular data, as a real `<table>`.',
          '',
          'Row and column association is what lets a screen reader say "Grace Hopper, Base salary, €14,200.00" instead of reading forty numbers in sequence. A grid of divs cannot do that, and no amount of ARIA patches it convincingly.',
          '',
          '### Parts and props',
          '',
          '| Part | Notable props |',
          '| --- | --- |',
          '| `TableRow` | `selected`: sets `aria-selected` and the accent wash. `interactive`: hover affordance; set it **only** if the whole row is genuinely clickable. |',
          '| `TableHead` | `numeric`: right-aligns the header over a numeric column. |',
          '| `TableCell` | `numeric`: right-aligns and locks tabular figures. |',
          '',
          '### Rules',
          '',
          '- Money, counts and dates go in `<TableCell numeric>`. Right-aligned tabular figures are what make a column comparable at a glance.',
          '- Amounts render through `Money`, never `toFixed`. See that component for why.',
          '- The table scrolls inside its own container, so a wide column set never makes the page scroll sideways.',
          '- Loading uses a skeleton shaped like the table. A spinner where a table will be is a layout shift scheduled in advance.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Directory: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Selection, mixed content, a numeric column and a footer total. The header checkbox reports `mixed` while the selection is partial; each row checkbox names the row it selects, so "Select Ada Lovelace" is what gets announced rather than "checkbox".',
      },
    },
  },
  render: function DirectoryStory() {
    const [selected, setSelected] = useState<string[]>(['EMP-004310']);
    const allSelected = selected.length === rows.length;
    const someSelected = selected.length > 0 && !allSelected;

    return (
      <Table>
        <TableCaption>
          Four of 912 people. Salaries shown in the tenant&rsquo;s base currency.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="Select all rows"
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={(next) => {
                  setSelected(next === true ? rows.map((row) => row.id) : []);
                }}
              />
            </TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Status</TableHead>
            <TableHead numeric>Hired</TableHead>
            <TableHead numeric>Base salary</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} interactive selected={selected.includes(row.id)}>
              <TableCell>
                <Checkbox
                  aria-label={`Select ${row.name}`}
                  checked={selected.includes(row.id)}
                  onCheckedChange={(next) => {
                    setSelected((current) =>
                      next === true ? [...current, row.id] : current.filter((id) => id !== row.id),
                    );
                  }}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <Avatar size="sm" name={row.name} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.name}</p>
                    <p className="truncate text-xs text-fg-muted">{row.role}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge dot tone={statusTone[row.status]} size="sm">
                  {statusLabel[row.status]}
                </Badge>
              </TableCell>
              <TableCell numeric>
                <time dateTime={row.hiredOn}>{row.hiredOn}</time>
              </TableCell>
              <TableCell numeric>
                <Money minorUnits={row.salaryMinorUnits} currency="EUR" locale="en-IE" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>Total</TableCell>
            <TableCell numeric>
              <Money minorUnits="4955000" currency="EUR" locale="en-IE" />
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    );
  },
};

export const NumericAlignment: Story = {
  name: 'Numeric alignment',
  parameters: {
    docs: {
      description: {
        story: [
          'Right-align numbers and money, with tabular figures and the same number of decimals down the whole column, so a column of amounts can be compared by eye. `numeric` does all three.',
          '',
          'Under a finger the row is a card, and the one figure it is compared on moves up beside the name: `cardTrailing` on the base salary. The other values wrap underneath, each after its `shortHeader`.',
        ].join('\n'),
      },
    },
  },
  render: () => {
    const shown = people.slice(0, 6);
    return (
      <div className="space-y-2">
        <DataTable<Person>
          label="Compensation"
          rows={shown}
          rowId={(p) => p.id}
          describeRow={(p) => p.name}
          columns={[
            personName,
            { id: 'team', header: 'Team', shortHeader: 'Team', cell: (p) => p.team },
            {
              id: 'fte',
              header: 'FTE',
              shortHeader: 'FTE',
              numeric: true,
              width: '4rem',
              cell: (p) => p.fte,
            },
            {
              id: 'salary',
              header: 'Base salary',
              numeric: true,
              cardTrailing: true,
              width: '8rem',
              cell: (p) => <Money minorUnits={p.salaryMinorUnits} currency="EUR" locale="en-GB" />,
            },
            {
              id: 'bonus',
              header: 'Bonus',
              shortHeader: 'Bonus',
              numeric: true,
              width: '7rem',
              cell: (p) => <Money minorUnits={p.bonusMinorUnits} currency="EUR" locale="en-GB" />,
            },
            {
              id: 'change',
              header: 'Change',
              shortHeader: 'Change',
              numeric: true,
              width: '6rem',
              cell: (p) => (
                <span
                  className={
                    p.change.startsWith('+')
                      ? 'text-success-fg'
                      : p.change.startsWith('−')
                        ? 'text-danger-fg'
                        : 'text-fg-subtle'
                  }
                >
                  {p.change}
                </span>
              ),
            },
          ]}
        />
        <p className="flex justify-between px-1 text-sm text-fg-muted">
          <span>Totals</span>
          <span className="font-semibold text-fg tabular-nums">
            <Money
              minorUnits={sumMinor(shown.map((p) => p.salaryMinorUnits))}
              currency="EUR"
              locale="en-GB"
            />
            {' · '}
            <Money
              minorUnits={sumMinor(shown.map((p) => p.bonusMinorUnits))}
              currency="EUR"
              locale="en-GB"
            />
          </span>
        </p>
      </div>
    );
  },
};

export const InteractiveRows: Story = {
  name: 'Interactive rows',
  parameters: {
    docs: {
      description: {
        story:
          'Set `interactive` only when the whole row is genuinely clickable, a hover affordance that leads nowhere is a promise the table does not keep. The row still needs a real focusable control inside it for keyboard users.',
      },
    },
  },
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Team</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={row.id} interactive selected={index === 1}>
            <TableCell>
              <a
                href={`#${row.id}`}
                className="font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                {row.name}
              </a>
            </TableCell>
            <TableCell className="text-fg-muted">{row.role}</TableCell>
            <TableCell>
              <Badge dot tone={statusTone[row.status]} size="sm">
                {statusLabel[row.status]}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const Loading: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The skeleton is shaped like the table it replaces, so nothing jumps when data lands. A spinner where a table will be is a layout shift you scheduled in advance.',
      },
    },
  },
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Status</TableHead>
          <TableHead numeric>Base salary</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[0, 1, 2, 3].map((index) => (
          <TableRow key={index}>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-6 rounded-full" />
                <Skeleton className="h-3.5 w-40" />
              </div>
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-20 rounded-full" />
            </TableCell>
            <TableCell numeric>
              <Skeleton className="ml-auto h-3.5 w-24" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const Empty: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'When there is nothing to show, the table is replaced rather than rendered with zero rows. A header row above nothing looks like a bug.',
      },
    },
  },
  render: () => (
    <EmptyState
      title="No one matches those filters"
      description="Three filters are active. Clearing the location filter would show 118 people."
    />
  ),
};

/* ------------------------------------------------------------------------- *
 * DataTable, the same primitives, with the four capabilities every table is
 * eventually asked for. They live here rather than in a component of their
 * own, because the first screen that needs two of them is every screen.
 * ------------------------------------------------------------------------- */

const dataColumns: DataColumn<Row>[] = [
  {
    id: 'name',
    header: 'Employee',
    sticky: true,
    width: '15rem',
    sortBy: (row) => row.name,
    cell: (row) => (
      <div className="flex items-center gap-2">
        <Avatar size="sm" name={row.name} />
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{row.name}</p>
          <p className="truncate text-2xs text-fg-subtle">{row.id}</p>
        </div>
      </div>
    ),
  },
  { id: 'role', header: 'Role', sortBy: (row) => row.role, cell: (row) => row.role },
  {
    id: 'status',
    header: 'Status',
    sortBy: (row) => statusLabel[row.status],
    cell: (row) => (
      <Badge size="sm" tone={statusTone[row.status]}>
        {statusLabel[row.status]}
      </Badge>
    ),
  },
  {
    id: 'hiredOn',
    header: 'Hired',
    // The one column that reads as a bare value on a card without saying what
    // it is: "2019-04-01" needs "Hired" in front of it; "Active" does not.
    shortHeader: 'Hired',
    numeric: true,
    sortBy: (row) => row.hiredOn,
    cell: (row) => row.hiredOn,
  },
  {
    id: 'salary',
    header: 'Salary',
    numeric: true,
    sortBy: (row) => Number(row.salaryMinorUnits),
    cell: (row) => <Money minorUnits={row.salaryMinorUnits} currency="EUR" />,
  },
];

const detailFor = (row: Row) => (
  <KeyValues
    layout="aligned"
    className="max-w-md"
    items={[
      { label: 'Employee number', value: row.id },
      { label: 'Hired', value: row.hiredOn },
      { label: 'Status', value: statusLabel[row.status] },
      {
        label: 'Base salary',
        value: <Money minorUnits={row.salaryMinorUnits} currency="EUR" />,
      },
    ]}
  />
);

export const Expandable: Story = {
  name: 'DataTable: expandable rows',
  parameters: {
    docs: {
      description: {
        story: [
          'A detail row is a `<tr>` with a spanning cell, not a `<div>` grafted underneath the table. That keeps the column relationships for a screen reader, keeps keyboard order in step with reading order, and keeps the whole thing printable.',
          '',
          'The disclosure is a real `<button>` with `aria-expanded`, `aria-controls`, and a name that includes its row. **"Expand Grace Hopper"**, not "Expand". Someone tabbing a column of chevrons hears the same word forty times otherwise.',
          '',
          'Watch the **Actions** panel: `onExpandedChange` reports the full set of open ids, not a toggle, so the caller can persist it.',
        ].join('\n'),
      },
    },
  },
  render: () => (
    <DataTable<Row>
      label="Employees"
      rows={rows}
      columns={dataColumns}
      rowId={(row) => row.id}
      describeRow={(row) => row.name}
      renderDetail={detailFor}
      defaultExpanded={['EMP-004310']}
      onExpandedChange={fn().mockName('onExpandedChange(openIds)')}
    />
  ),
};

export const SelectionAndBulkActions: Story = {
  name: 'DataTable: selection and bulk actions',
  parameters: {
    docs: {
      description: {
        story: [
          'Row checkboxes, a header checkbox that goes **indeterminate** when the selection is partial, and a bulk bar that appears once anything is picked.',
          '',
          'The bar sits **above** the table and in flow, not pinned over the last row, a floating bar covers the row somebody is about to act on. It wraps on a narrow screen rather than pushing the count off the edge.',
          '',
          'Two details that matter: the select-all is named for what it does *now* (`Clear selection` once everything is picked, which is what it will actually do), and a checkbox click stops propagating, so selecting a row in a table whose rows are also clickable does not also open the row.',
          '',
          '`bulkActions` is handed **the selected rows**, not their ids, an action that has to look its own rows back up is an action that will eventually look up the wrong ones.',
        ].join('\n'),
      },
    },
  },
  render: function SelectionStory() {
    const [selected, setSelected] = useState<readonly string[]>([]);
    const log = fn().mockName('onSelectedChange(selectedIds)');

    return (
      <DataTable<Row>
        label="Employees"
        rows={rows}
        columns={dataColumns}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        selectable
        selected={selected}
        onSelectedChange={(next) => {
          setSelected(next);
          log(next);
        }}
        bulkActions={(picked) => (
          <>
            <Button size="sm" variant="secondary" onClick={fn().mockName('bulk: export')}>
              Export {picked.length}
            </Button>
            <Button size="sm" variant="secondary" onClick={fn().mockName('bulk: assign reviewer')}>
              Assign reviewer
            </Button>
            <Button size="sm" variant="destructive" onClick={fn().mockName('bulk: offboard')}>
              Offboard
            </Button>
          </>
        )}
      />
    );
  },
};

export const Sorting: Story = {
  name: 'DataTable: sorting',
  parameters: {
    docs: {
      description: {
        story: [
          'Click to sort, click again to reverse. With `multiSort`, **shift-click adds a second sort**, and the small numbers in the headers show the order. Here: by team, then by start date, newest first. Under a finger the headers become chips and a strip says "Sorted by Team, then start date".',
          '',
          'Any column with a `sortBy` becomes a sort control. `aria-sort` goes on the `<th>` of the primary sort only, as ARIA asks; a secondary one says its place in its button name.',
          '',
          'Sorting is **uncontrolled by default and it sorts for you**, through TanStack Table: `sortBy` returns the value to compare, numbers compare as numbers, and strings compare naturally. Pass `sort` (one sort or a list) and it becomes controlled, and the rows arrive in whatever order you decided, which is what server-side sorting looks like. `onSortsChange` has the whole list; `onSortChange` the primary.',
        ].join('\n'),
      },
    },
  },
  render: () => (
    <DataTable<Person>
      label="People"
      rows={people.slice(0, 10)}
      columns={personColumns}
      rowId={(p) => p.id}
      describeRow={(p) => p.name}
      multiSort
      defaultSort={[
        { columnId: 'team', direction: 'ascending' },
        { columnId: 'start', direction: 'descending' },
      ]}
      onSortsChange={fn().mockName('onSortsChange(sorts)')}
    />
  ),
};

export const Reorderable: Story = {
  name: 'DataTable: drag to reorder',
  parameters: {
    docs: {
      description: {
        story: [
          'A handle per row, in its own cell. Not on the row itself: a row is where click-to-select and the row link live, and a whole-row activator eats both. The handle is named *"Reorder Grace Hopper"*, and dnd-kit’s keyboard sensor drives it with Space and the arrows.',
          '',
          '**Sorting and manual order are mutually exclusive.** Sort a column here and the handles disappear, replaced by a line saying why, a dragged row means nothing in a sorted table, because the next sort discards it. Accepting the gesture anyway would be the interface lying about what it just did.',
          '',
          '`onReorder` hands back `{ id, from, to, order }`. The order is yours; the table does not keep it.',
        ].join('\n'),
      },
    },
  },
  render: function ReorderStory() {
    const [order, setOrder] = useState<Row[]>(rows);
    const log = fn().mockName('onReorder({ id, from, to, order })');

    return (
      <DataTable<Row>
        label="Approval order"
        rows={order}
        columns={dataColumns}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        reorderable
        onReorder={(move) => {
          log(move);
          setOrder((current) => {
            const byId = new Map(current.map((row) => [row.id, row]));
            return move.order.flatMap((id) => byId.get(id) ?? []);
          });
        }}
      />
    );
  },
};

export const Everything: Story = {
  name: 'DataTable, all of it at once',
  parameters: {
    docs: {
      description: {
        story: [
          'Selection, expansion, sorting and a sticky header on one table, and that is the reason for it of it being one component. Every capability is a prop, every one is off by default, and the leading columns arrange themselves in a fixed order (reorder, select, expand) so a row never rearranges under the pointer as capabilities are switched on.',
          '',
          'On a desk the identity column is `sticky`, so the names stay put while the rest scrolls sideways. Under a finger each row becomes a card: see the next story.',
        ].join('\n'),
      },
    },
  },
  render: function EverythingStory() {
    const [selected, setSelected] = useState<readonly string[]>(['EMP-004182']);

    return (
      <DataTable<Row>
        label="Employees"
        rows={rows}
        columns={dataColumns}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        renderDetail={detailFor}
        defaultSort={{ columnId: 'name', direction: 'ascending' }}
        stickyHeader
        containerClassName="max-h-96"
        onSortChange={fn().mockName('onSortChange({ columnId, direction })')}
        onExpandedChange={fn().mockName('onExpandedChange(openIds)')}
        bulkActions={(picked) => (
          <Button size="sm" variant="secondary" onClick={fn()}>
            Export {picked.length}
          </Button>
        )}
      />
    );
  },
};

export const NarrowScreen: Story = {
  name: 'DataTable, on a phone',
  parameters: {
    docs: {
      description: {
        story: [
          'Under a coarse pointer each row becomes a card: the first column is the title and the others wrap beneath it, prefixed with their `shortHeader` where one is set. Sortable headers turn into a row of chips, and the select-all box gets a visible "Select all".',
          '',
          'It is the same `<table>` with different CSS, not a second tree, so a screen reader still hears "Hired, 2019-04-01" with the header attached, and selection, expansion and the handles all keep working.',
          '',
          'The switch is the pointer, never the width. A narrow window on a desk still has a mouse, and still gets columns.',
        ].join('\n'),
      },
    },
  },
  render: function NarrowStory() {
    const [selected, setSelected] = useState<readonly string[]>([]);

    return (
      <DataTable<Row>
        label="Employees"
        rows={rows}
        columns={dataColumns}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        renderDetail={detailFor}
        bulkActions={(picked) => (
          <Button size="sm" variant="secondary" onClick={fn()}>
            Export {picked.length}
          </Button>
        )}
      />
    );
  },
};

export const MenuOnEachCard: Story = {
  name: 'DataTable, a menu on each card',
  parameters: {
    docs: {
      description: {
        story:
          'Each row has a menu at its end. Under a finger it is usually left off the card, because the card opens the record and its actions live there; `rowMenuOnCard` keeps it, at the end of the title line, for a list whose actions have no other way in.',
      },
    },
  },
  render: () => (
    <DataTable<Row>
      label="Employees"
      rows={rows.slice(0, 4)}
      columns={dataColumns.slice(0, 3)}
      rowId={(row) => row.id}
      describeRow={(row) => row.name}
      rowMenuOnCard
      rowActions={() => [
        { id: 'rename', label: 'Rename', onSelect: fn() },
        { id: 'archive', label: 'Archive', destructive: true, onSelect: fn() },
      ]}
    />
  ),
};

export const Dense: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`dense` for a ledger read line by line: 40px rows, 13px type and tighter gutters. It changes nothing under a finger, where the rows are cards and 44px is the floor anyway.',
      },
    },
  },
  render: () => (
    <DataTable<Row>
      label="Employees"
      rows={rows}
      columns={dataColumns}
      rowId={(row) => row.id}
      describeRow={(row) => row.name}
      dense
    />
  ),
};

/**
 * Five thousand rows, with only the visible ones in the DOM.
 *
 * Past `virtualizeThreshold` the body renders a window of rows plus two spacer
 * rows carrying the height of everything scrolled past. The spacers are `<tr>`
 * elements rather than a transform, because a `<tbody>` may only contain rows
 * and transforming them detaches the column widths from the header.
 *
 * The count a screen reader hears comes from `aria-rowcount` on the table and
 * `aria-rowindex` on each row. Without those it would announce the twenty or so
 * rows that happen to be mounted as though that were the whole table, which is
 * the failure mode that makes naive virtualization worse than no virtualization.
 */
export const Virtualized: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Virtualization is `auto` by default and switches on past 100 rows. It stays off while `reorderable` is set, because dnd-kit resolves a drop against mounted nodes and an unmounted row is not a drop target, and off when `renderDetail` is given, because a detail row has an arbitrary height that would have to be measured.',
      },
    },
  },
  render: function VirtualizedTable() {
    const manyRows: Row[] = Array.from({ length: 5000 }, (_, index) => ({
      id: `EMP-${String(100_000 + index)}`,
      name: `Employee ${String(index + 1)}`,
      role: ['Engineer', 'Designer', 'Analyst', 'Manager'][index % 4] ?? 'Engineer',
      status: (['active', 'on-leave', 'offboarding'] as const)[index % 3] ?? 'active',
      hiredOn: `20${String(15 + (index % 10)).padStart(2, '0')}-0${String((index % 9) + 1)}-15`,
      salaryMinorUnits: String(4_000_000 + index * 137),
    }));

    return (
      <DataTable<Row>
        label="Every employee"
        caption="5000 rows. Only the visible window is mounted."
        rows={manyRows}
        columns={dataColumns}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        selectable
        stickyHeader
        containerClassName="h-[32rem]"
      />
    );
  },
};

/**
 * A long list read row by row: striped, columns widened by dragging (or the
 * arrow keys on a header's edge), and the next page fetched as the reader
 * nears the end, then virtualized like any other long table.
 */
export const InfiniteVirtualized: Story = {
  name: 'Infinite and virtualized',
  render: function InfiniteTable() {
    const page = (from: number): Row[] =>
      Array.from({ length: 50 }, (_, i) => {
        const index = from + i;
        return {
          id: `EMP-${String(200_000 + index)}`,
          name: `Employee ${String(index + 1)}`,
          role: ['Engineer', 'Designer', 'Analyst', 'Manager'][index % 4] ?? 'Engineer',
          status: (['active', 'on-leave', 'offboarding'] as const)[index % 3] ?? 'active',
          hiredOn: `20${String(15 + (index % 10)).padStart(2, '0')}-0${String((index % 9) + 1)}-15`,
          salaryMinorUnits: String(4_000_000 + index * 137),
        };
      });
    const [loaded, setLoaded] = useState<Row[]>(() => page(0));
    const [loading, setLoading] = useState(false);
    const more = () => {
      if (loading || loaded.length >= 1000) return;
      setLoading(true);
      setTimeout(() => {
        setLoaded((rows) => [...rows, ...page(rows.length)]);
        setLoading(false);
      }, 300);
    };
    return (
      <DataTable<Row>
        label="Every employee, loaded as you scroll"
        caption={`${String(loaded.length)} of 1000 loaded${loading ? ', loading more…' : ''}`}
        rows={loaded}
        columns={dataColumns}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        striped
        resizable
        stickyHeader
        virtualize
        loadingMore={loading}
        onEndReached={more}
        containerClassName="h-[32rem]"
      />
    );
  },
  play: async ({ canvasElement }) => {
    // Under a finger the rows are cards under a header strip of their own.
    if (window.matchMedia('(pointer: coarse)').matches) return;
    const box = canvasElement.querySelector<HTMLElement>('[role="region"]');
    if (box === null) throw new Error('No table');
    await waitFor(async () => {
      await expect(box.scrollHeight).toBeGreaterThan(box.clientHeight * 2);
    });
    box.scrollTop = box.scrollHeight / 2;
    await waitFor(async () => {
      await expect(canvasElement.querySelector('tbody tr[data-spacer]')).not.toBeNull();
    });
    // The header holds over the rows scrolling under it: the pinned corner
    // and a plain header cell are each the topmost thing where they are.
    const heads = [...canvasElement.querySelectorAll<HTMLElement>('thead th')];
    for (const th of [heads[0], heads[2]]) {
      const r = th?.getBoundingClientRect();
      if (th === undefined || r === undefined) throw new Error('No header');
      const top = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
      await expect(th.contains(top)).toBe(true);
      await expect(getComputedStyle(th).backgroundColor).not.toMatch(/rgba\(.*, 0\)|transparent/);
    }
    // Every other row by its place in the list, wherever the scroll left the DOM.
    const rows = [...canvasElement.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')];
    await expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const place = Number(row.getAttribute('aria-rowindex')) - 2;
      await expect(row.hasAttribute('data-striped')).toBe(place % 2 === 1);
    }
    box.scrollTop = 0;
  },
};

const employeePage = (from: number): Row[] =>
  Array.from({ length: 50 }, (_, i) => {
    const index = from + i;
    return {
      id: `EMP-${String(300_000 + index)}`,
      // Names that grow, so a table laid out on its content would widen as they arrive.
      name: `Employee ${String(index + 1)}${index % 7 === 6 ? ' Featherstonehaugh-Cholmondeley' : ''}`,
      role:
        ['Engineer', 'Principal product designer', 'Analyst', 'Manager'][index % 4] ?? 'Engineer',
      status: (['active', 'on-leave', 'offboarding'] as const)[index % 3] ?? 'active',
      hiredOn: `20${String(15 + (index % 10)).padStart(2, '0')}-0${String((index % 9) + 1)}-15`,
      salaryMinorUnits: String(4_000_000 + index * 137),
    };
  });

/** A table that keeps loading, fifty rows a page, 300 ms a page, up to 500. */
function useLoadingRows(): { rows: Row[]; loading: boolean; more: () => void } {
  const [rows, setRows] = useState<Row[]>(() => employeePage(0));
  const [loading, setLoading] = useState(false);
  const more = (): void => {
    if (loading || rows.length >= 500) return;
    setLoading(true);
    setTimeout(() => {
      setRows((current) => [...current, ...employeePage(current.length)]);
      setLoading(false);
    }, 300);
  };
  return { rows, loading, more };
}

/** Header widths, in px, as laid out. */
const headerWidths = (root: HTMLElement): string =>
  [...root.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect().width).join(',');

export const ColumnsFixedWhileLoading: Story = {
  name: 'Infinite, columns fixed',
  parameters: {
    docs: {
      description: {
        story:
          '`columnSizing="fixed"` lays the table out on the declared widths, and gives spare room once to the columns the first rows overflow. After that nothing moves them: not a page arriving, not a long name scrolling into view, not the scrollbar appearing. It is the default with `resizable`. A table that loads more starts virtualized, rather than switching on mid-scroll and remounting the rows on screen.',
      },
    },
  },
  render: function FixedColumns() {
    const { rows: loaded, loading, more } = useLoadingRows();
    return (
      <DataTable<Row>
        label="Employees, loaded as you scroll"
        caption={`${String(loaded.length)} of 500 loaded`}
        rows={loaded}
        columns={dataColumns}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        columnSizing="fixed"
        stickyHeader
        loadingMore={loading}
        onEndReached={more}
        containerClassName="h-[28rem]"
      />
    );
  },
  play: async ({ canvasElement }) => {
    // Under a finger the rows are cards, and there are no columns to hold.
    if (window.matchMedia('(pointer: coarse)').matches) return;
    const box = canvasElement.querySelector<HTMLElement>('[role="region"]');
    if (box === null) throw new Error('No table');
    const before = headerWidths(canvasElement);
    for (const loaded of ['100 of', '150 of']) {
      box.scrollTop = box.scrollHeight;
      await waitFor(async () => {
        await expect(canvasElement.querySelector('caption')).toHaveTextContent(loaded);
      });
    }
    await expect(headerWidths(canvasElement)).toBe(before);
    box.scrollTop = 0;
  },
};

/**
 * A row brought back into view from outside the table: a detail pane's "Show
 * in list", say. `ref` hands over `revealRow(id, { focus })`, which scrolls
 * smoothly (or jumps, with reduced motion), mounts a virtualized row on the
 * way, does nothing to a row already in full view, and lands the keyboard on it.
 */
export const RevealRow: Story = {
  name: 'Reveal a row',
  render: function Reveal() {
    const { rows: loaded, loading, more } = useLoadingRows();
    const table = useRef<DataTableHandle | null>(null);
    return (
      <div className="space-y-3">
        <Button
          size="sm"
          onClick={() => {
            table.current?.revealRow('EMP-300000', { focus: true });
          }}
        >
          Show Employee 1
        </Button>
        <DataTable<Row>
          ref={table}
          label="Employees"
          rows={loaded}
          columns={dataColumns}
          rowId={(row) => row.id}
          describeRow={(row) => row.name}
          onRowClick={fn()}
          resizable
          stickyHeader
          loadingMore={loading}
          onEndReached={more}
          containerClassName="h-[28rem]"
        />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>('[role="region"]');
    if (box === null) throw new Error('No table');
    box.scrollTop = box.scrollHeight;
    await waitFor(async () => {
      await expect(canvasElement.querySelector('tr[data-row-id="EMP-300000"]')).toBeNull();
    });
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Show Employee 1' }));
    await waitFor(async () => {
      const row = canvasElement.querySelector('tr[data-row-id="EMP-300000"]');
      await expect(row).toHaveFocus();
    });
  },
};

/**
 * Sorting a virtualized table.
 *
 * Worth its own story because the two features are easy to get wrong together:
 * the sort has to reorder all 5000 rows, not the twenty on screen, and the
 * scroll position has to be interpreted against the new order. Sort by salary
 * and scroll: the sequence stays monotonic all the way down, which it would not
 * if only the mounted window were sorted.
 */
export const VirtualizedAndSorted: Story = {
  name: 'Virtualized, sorted',
  render: function VirtualizedSortedTable() {
    const manyRows: Row[] = Array.from({ length: 5000 }, (_, index) => ({
      id: `EMP-${String(300_000 + index)}`,
      name: `Employee ${String(index + 1)}`,
      role: ['Engineer', 'Designer', 'Analyst', 'Manager'][index % 4] ?? 'Engineer',
      status: (['active', 'on-leave', 'offboarding'] as const)[index % 3] ?? 'active',
      hiredOn: `20${String(15 + (index % 10)).padStart(2, '0')}-0${String((index % 9) + 1)}-15`,
      // Deliberately not monotonic with the index, so a sort has real work to do.
      salaryMinorUnits: String(3_000_000 + ((index * 7919) % 5_000_000)),
    }));

    return (
      <DataTable<Row>
        label="Salaries"
        caption="5000 rows, sorted across all of them rather than across the visible window."
        rows={manyRows}
        columns={dataColumns}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        defaultSort={{ columnId: 'salary', direction: 'descending' }}
        stickyHeader
        containerClassName="h-[32rem]"
      />
    );
  },
};

/**
 * Selecting across rows that are not mounted.
 *
 * Select-all in a virtualized table selects every row, not the window. The
 * count in the bulk bar is the honest total, and clearing it clears all of
 * them. Getting this wrong is the classic virtualization bug: an action that
 * silently applies to the twenty rows that happened to be rendered.
 */
export const VirtualizedSelection: Story = {
  name: 'Virtualized, selection',
  render: function VirtualizedSelectionTable() {
    const manyRows: Row[] = Array.from({ length: 2500 }, (_, index) => ({
      id: `EMP-${String(400_000 + index)}`,
      name: `Employee ${String(index + 1)}`,
      role: ['Engineer', 'Designer', 'Analyst', 'Manager'][index % 4] ?? 'Engineer',
      status: (['active', 'on-leave', 'offboarding'] as const)[index % 3] ?? 'active',
      hiredOn: '2022-03-15',
      salaryMinorUnits: String(4_200_000 + index * 97),
    }));

    const [selected, setSelected] = useState<readonly string[]>([]);

    return (
      <DataTable<Row>
        label="Everyone, selectable"
        caption={`${String(selected.length)} of 2500 selected.`}
        rows={manyRows}
        columns={dataColumns}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={(picked) => (
          <Button size="sm" variant="secondary" onClick={fn()}>
            Export {picked.length}
          </Button>
        )}
        stickyHeader
        containerClassName="h-[28rem]"
      />
    );
  },
};

/**
 * The same table with virtualization turned off.
 *
 * Here so the difference can be seen rather than described: identical rows,
 * identical behaviour, every row in the document. This is what `virtualize`
 * defaults away from past a hundred rows, and what a caller opts back into when
 * they need Ctrl+F to find a row the browser has not rendered.
 */
export const VirtualizationOff: Story = {
  name: 'Virtualization off',
  parameters: {
    docs: {
      description: {
        story:
          'Browser find, print, and "select all text" only see mounted rows. Where that matters more than the render cost, set `virtualize={false}` and accept the DOM size.',
      },
    },
    // Not snapshotted: a diff across a hundred and twenty near-identical rows
    // carries no signal a diff of the first six would not. The virtualized
    // stories cover how the table looks. axe and the contrast sweep still
    // measure it.
    chromatic: { disableSnapshot: true },
  },
  render: function UnvirtualizedTable() {
    // Just past the hundred rows where `virtualize` turns itself on, which is
    // all the story has to show. It held 600: axe over 8,500 nodes took 6 s
    // here and more than CI's 15 s test timeout on a shared runner, and held
    // up the next story in the file while it ran.
    const manyRows: Row[] = Array.from({ length: 120 }, (_, index) => ({
      id: `EMP-${String(500_000 + index)}`,
      name: `Employee ${String(index + 1)}`,
      role: ['Engineer', 'Designer', 'Analyst', 'Manager'][index % 4] ?? 'Engineer',
      status: (['active', 'on-leave', 'offboarding'] as const)[index % 3] ?? 'active',
      hiredOn: '2021-09-01',
      salaryMinorUnits: String(3_900_000 + index * 53),
    }));

    return (
      <DataTable<Row>
        label="Everyone, fully rendered"
        caption="120 rows, all of them in the document."
        rows={manyRows}
        columns={dataColumns}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        virtualize={false}
        stickyHeader
        containerClassName="h-[28rem]"
      />
    );
  },
};

export const Grouped: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          '`groupBy` returns the value to group on, which need not be a column. Each group gets a header row with its count and, under each column that has an `aggregate`, a summary: here the salary total, added in minor units so it stays exact.',
          '',
          "The headers collapse. A collapsed group keeps its count and its sum, which is often all a reader wanted from it. `defaultCollapsedGroups` starts Sales shut. The grouping itself is TanStack Table's.",
        ].join('\n'),
      },
    },
  },
  render: function GroupedStory() {
    const byTeam = useCallback((p: Person) => p.team, []);
    return (
      <DataTable<Person>
        label="Salaries by team"
        rows={people.filter((p) => ['Engineering', 'Design', 'Sales'].includes(p.team))}
        rowId={(p) => p.id}
        describeRow={(p) => p.name}
        groupBy={byTeam}
        defaultCollapsedGroups={['Sales']}
        columns={[
          personName,
          { id: 'location', header: 'Location', cell: (p) => p.location },
          {
            id: 'fte',
            header: 'FTE',
            shortHeader: 'FTE',
            numeric: true,
            width: '4rem',
            cell: (p) => p.fte,
          },
          {
            id: 'salary',
            header: 'Base salary',
            numeric: true,
            cardTrailing: true,
            width: '8rem',
            cell: (p) => <Money minorUnits={p.salaryMinorUnits} currency="EUR" locale="en-GB" />,
            aggregate: (group) => (
              <Money
                minorUnits={sumMinor(group.map((p) => p.salaryMinorUnits))}
                currency="EUR"
                locale="en-GB"
              />
            ),
          },
        ]}
      />
    );
  },
};

export const InfiniteStripedResizable: Story = {
  name: 'Infinite, striped, resizable',
  parameters: {
    docs: {
      description: {
        story: [
          '**Infinite:** `onEndReached` is called as the reader nears the end of what is loaded, and `loadingMore` shows a skeleton row, in the rows’ own shape, under the last one and holds further calls off while the page is on its way. Scroll the table: it loads twelve more at a time, up to 48.',
          '',
          '**Striped:** `striped` tints every other row, for a wide table read across rather than down.',
          '',
          '**Resizable:** drag the edge of a header, or Tab to it and use the arrow keys (Shift for bigger steps). The table lays out on the widths, so a cell ellipsizes rather than pushing its neighbours; `columnWidths` and `onColumnWidthsChange` keep them. Under a finger the table is cards and there is nothing to resize.',
        ].join('\n'),
      },
    },
  },
  render: function InfiniteStory() {
    const [shown, setShown] = useState<Person[]>(() => people.slice());
    const [loading, setLoading] = useState(false);
    const more = (): void => {
      setLoading(true);
      setTimeout(() => {
        setShown((current) =>
          current.concat(people.map((p) => ({ ...p, id: `${p.id}-${String(current.length)}` }))),
        );
        setLoading(false);
      }, 900);
    };
    return (
      <DataTable<Person>
        label="People"
        rows={shown}
        columns={personColumns.slice(0, 4)}
        rowId={(p) => p.id}
        describeRow={(p) => p.name}
        striped
        resizable
        stickyHeader
        containerClassName="max-h-96"
        loadingMore={loading}
        {...(shown.length >= 48 ? {} : { onEndReached: more })}
      />
    );
  },
};
