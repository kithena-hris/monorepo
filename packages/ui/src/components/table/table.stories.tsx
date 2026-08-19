import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Checkbox } from '../checkbox/checkbox';
import { EmptyState, Skeleton } from '../feedback/feedback';
import { Money } from '../money/money';
import { Button } from '../button/button';
import { DataTable, type DataColumn, type DataTableSort } from './data-table';
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
        story:
          'The same column twice. On the left, `numeric`: right-aligned, tabular. On the right, default cells. Scan down each and the difference stops being a matter of taste.',
      },
    },
  },
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead numeric>numeric</TableHead>
          <TableHead>default</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell numeric>
              <Money minorUnits={row.salaryMinorUnits} currency="EUR" locale="en-IE" />
            </TableCell>
            <TableCell className="[font-variant-numeric:proportional-nums]">
              <Money
                minorUnits={row.salaryMinorUnits}
                currency="EUR"
                locale="en-IE"
                className="[font-variant-numeric:proportional-nums]"
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
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
  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
    <div className="flex gap-2">
      <dt className="text-fg-subtle">Employee number</dt>
      <dd className="font-medium text-fg">{row.id}</dd>
    </div>
    <div className="flex gap-2">
      <dt className="text-fg-subtle">Hired</dt>
      <dd className="font-medium text-fg">{row.hiredOn}</dd>
    </div>
    <div className="flex gap-2">
      <dt className="text-fg-subtle">Status</dt>
      <dd className="font-medium text-fg">{statusLabel[row.status]}</dd>
    </div>
    <div className="flex gap-2">
      <dt className="text-fg-subtle">Base salary</dt>
      <dd className="font-medium text-fg">
        <Money minorUnits={row.salaryMinorUnits} currency="EUR" />
      </dd>
    </div>
  </dl>
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
          'Any column with a `sortBy` becomes a sort control. `aria-sort` goes on the `<th>`, an arrow glyph tells a screen reader nothing.',
          '',
          'Sorting is **uncontrolled by default and it sorts for you**: `sortBy` returns the value to compare, numbers compare as numbers, and strings go through `localeCompare` so *Ärztin* lands where a German reader expects rather than after *Z*.',
          '',
          'Pass `sort` and it becomes controlled and the rows arrive in whatever order you decided, which is what server-side sorting looks like. `onSortChange` fires either way; check the Actions panel.',
        ].join('\n'),
      },
    },
  },
  render: function SortingStory() {
    const [sort, setSort] = useState<DataTableSort | null>({
      columnId: 'salary',
      direction: 'descending',
    });
    const log = fn().mockName('onSortChange({ columnId, direction })');

    return (
      <DataTable<Row>
        label="Employees"
        rows={rows}
        columns={dataColumns}
        rowId={(row) => row.id}
        describeRow={(row) => row.name}
        defaultSort={sort}
        onSortChange={(next) => {
          setSort(next);
          log(next);
        }}
        caption="Sorted by salary, highest first."
      />
    );
  },
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
          'Resize the preview: the identity column is `sticky`, so the names stay put while the rest scrolls sideways. That is the mobile answer for a table, not turning rows into cards, which throws away the header association, the column order and any chance of comparing two rows.',
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
  globals: { viewport: { value: 'iphone15', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story: [
          'The same table at 393px. It **stays a table**: it scrolls sideways with the identity column pinned, so a name is always attached to whatever figure you have scrolled to.',
          '',
          'The tempting alternative, one card per row: reads well in a screenshot and badly in use: it drops the header association, it drops the column order, and it makes comparing two rows impossible, which is most of what anybody opens a table for.',
          '',
          'What does change on a small screen is the touch targets. Every control here is at least `--reach-tap-min` (44px) because `@media (pointer: coarse)` re-points the density tokens, the checkbox, the chevron and the drag handle grow without a single breakpoint being written.',
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
  },
  render: function UnvirtualizedTable() {
    const manyRows: Row[] = Array.from({ length: 600 }, (_, index) => ({
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
        caption="600 rows, all of them in the document."
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
