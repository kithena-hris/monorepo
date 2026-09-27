import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { ColumnChooser, orderColumns, type ColumnChooserValue } from './column-chooser';
import { DataTable, type DataColumn, type DataTableSort } from './data-table';

const columns = [
  { id: 'name', label: 'Name', locked: true },
  { id: 'title', label: 'Job title' },
  { id: 'team', label: 'Team' },
  { id: 'manager', label: 'Manager' },
  { id: 'location', label: 'Location' },
  { id: 'start', label: 'Start date' },
];

const initial: ColumnChooserValue = {
  order: columns.map((c) => c.id),
  visible: ['name', 'title', 'team', 'start'],
};

const meta = {
  title: 'Components/ColumnChooser',
  component: ColumnChooser,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Which columns a table shows, and in what order, as one list: tick a row to show it, drag it or use its Move buttons to place it.',
          '',
          '### Controlled, and remembers nothing',
          '',
          'The chooser holds no state. Where a choice is kept, a browser, a profile or nowhere, is the application’s decision, because the design system cannot know whose choice it is.',
          '',
          '### A locked column stays',
          '',
          'The identity column is `locked`: always shown, never moved. A table without one is a grid of anonymous values.',
          '',
          '### The trigger says the state',
          '',
          'A popover hides what it holds, so the trigger carries the count: somebody wondering where a column went is told before they open anything.',
        ].join('\n'),
      },
    },
  },
  args: { columns, value: initial, onChange: fn() },
} satisfies Meta<typeof ColumnChooser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function Playground(args) {
    const [value, setValue] = useState(initial);
    return (
      <ColumnChooser
        {...args}
        value={value}
        onChange={(next) => {
          setValue(next);
          args.onChange(next);
        }}
        onReset={() => {
          setValue(initial);
        }}
      />
    );
  },
};

interface Row {
  id: string;
  name: string;
  title: string;
  team: string;
  manager: string;
  location: string;
  start: string;
}

const rows: Row[] = [
  {
    id: '1',
    name: 'Grace Hopper',
    title: 'Chief Executive',
    team: 'Leadership',
    manager: '',
    location: 'Arlington',
    start: '2019-03-01',
  },
  {
    id: '2',
    name: 'Alan Turing',
    title: 'VP Engineering',
    team: 'Engineering',
    manager: 'Grace Hopper',
    location: 'Manchester',
    start: '2020-06-15',
  },
  {
    id: '3',
    name: 'Katherine Johnson',
    title: 'Head of Research',
    team: 'Research',
    manager: 'Grace Hopper',
    location: 'Hampton',
    start: '2021-01-04',
  },
  {
    id: '4',
    name: 'Barbara Liskov',
    title: 'Engineer',
    team: 'Engineering',
    manager: 'Alan Turing',
    location: 'Boston',
    start: '2024-09-02',
  },
];

export const WithATable: Story = {
  name: 'Driving a table',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story:
          'The table is handed only the columns shown, in the chosen order, and sorted by the header the reader pressed. The sort here is controlled, which is what a server-sorted table looks like: the rows arrive in the order they were asked for.',
      },
    },
  },
  render: function WithATable() {
    const [value, setValue] = useState(initial);
    const [sort, setSort] = useState<DataTableSort | null>({
      columnId: 'name',
      direction: 'ascending',
    });
    const all: Record<string, DataColumn<Row>> = Object.fromEntries(
      columns.map((c) => [
        c.id,
        {
          id: c.id,
          header: c.label,
          sticky: c.locked === true,
          numeric: c.id === 'start',
          sortBy: (r: Row) => r[c.id as keyof Row],
          cell: (r: Row) => r[c.id as keyof Row],
        },
      ]),
    );
    const shown = orderColumns(columns, value.order)
      .filter((c) => c.locked === true || value.visible.includes(c.id))
      .flatMap((c) => {
        const column = all[c.id];
        return column === undefined ? [] : [column];
      });
    const key = sort?.columnId as keyof Row | undefined;
    const sorted =
      key === undefined
        ? rows
        : rows.toSorted(
            (a, b) =>
              a[key].localeCompare(b[key]) * (sort?.direction === 'descending' ? -1 : 1),
          );
    return (
      <div className="flex flex-col gap-3">
        <div className="flex justify-end">
          <ColumnChooser
            columns={columns}
            value={value}
            onChange={setValue}
            onReset={() => {
              setValue(initial);
            }}
          />
        </div>
        <DataTable
          label="People"
          rows={sorted}
          columns={shown}
          rowId={(r) => r.id}
          sort={sort}
          onSortChange={setSort}
          stickyHeader
          containerClassName="max-h-64"
        />
      </div>
    );
  },
};
