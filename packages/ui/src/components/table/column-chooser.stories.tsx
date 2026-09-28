import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Avatar } from '../avatar/avatar';
import { ColumnChooser, type ColumnChoice } from './column-chooser';
import { DataTable, type DataColumn } from './data-table';

const allColumns: ColumnChoice[] = [
  { id: 'name', label: 'Name', locked: true },
  { id: 'team', label: 'Team' },
  { id: 'location', label: 'Location' },
  { id: 'status', label: 'Status' },
  { id: 'start', label: 'Start date' },
  { id: 'manager', label: 'Manager' },
  { id: 'salary', label: 'Salary' },
  { id: 'employee-id', label: 'Employee ID' },
];

const meta = {
  title: 'Components/ColumnChooser',
  component: ColumnChooser,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Lets people pick and reorder the columns of a table. Ticks commit as they are made, with no Save button; the trigger shows the count, because a popover hides its own state.',
          '',
          'The identity column is `locked`: ticked, disabled and fixed in first place. With `onReorder` every other row has a grip, which works by drag or by Space and the arrow keys. Past eight columns the list gets a search box, and the grips step aside while it is in use.',
        ].join('\n'),
      },
    },
  },
  args: {
    columns: allColumns,
    visible: ['name', 'team', 'location', 'status', 'start'],
    onVisibleChange: fn(),
  },
} satisfies Meta<typeof ColumnChooser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory(args) {
    const [columns, setColumns] = useState<readonly ColumnChoice[]>(allColumns);
    const [visible, setVisible] = useState<readonly string[]>(args.visible);

    return (
      <div className="flex justify-end">
        <ColumnChooser
          columns={columns}
          visible={visible}
          onVisibleChange={(next) => {
            args.onVisibleChange(next);
            setVisible(next);
          }}
          onReorder={(order) => {
            const byId = new Map(columns.map((column) => [column.id, column]));
            setColumns(order.flatMap((id) => byId.get(id) ?? []));
          }}
          onReset={() => {
            setColumns(allColumns);
            setVisible(args.visible);
          }}
        />
      </div>
    );
  },
};

interface Person {
  id: string;
  name: string;
  team: string;
  manager: string;
}

const people: Person[] = [
  { id: 'p1', name: 'Priya Raman', team: 'Engineering', manager: 'Jonas Weber' },
  { id: 'p2', name: 'Mei Tanaka', team: 'Design', manager: 'Nora Becker' },
  { id: 'p3', name: 'Lucas Moreau', team: 'Engineering', manager: 'Jonas Weber' },
  { id: 'p4', name: 'Amara Okafor', team: 'Sales', manager: 'Tom Fischer' },
];

const tableColumns: DataColumn<Person>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (person) => (
      <span className="flex items-center gap-3">
        <Avatar size="sm" name={person.name} />
        <span className="font-semibold">{person.name}</span>
      </span>
    ),
  },
  { id: 'team', header: 'Team', cell: (person) => person.team },
  { id: 'manager', header: 'Manager', cell: (person) => person.manager },
];

const labels: Record<string, string> = { name: 'Name', team: 'Team', manager: 'Manager' };

export const DrivingATable: Story = {
  name: 'Driving a table',
  parameters: {
    docs: {
      description: {
        story:
          'The chooser owns the popover and the ticks; the table is simply handed the columns that are on, in the chooser’s order.',
      },
    },
  },
  render: function DrivingStory() {
    const [order, setOrder] = useState<readonly string[]>(tableColumns.map((c) => c.id));
    const [visible, setVisible] = useState<readonly string[]>(order);
    const byId = new Map(tableColumns.map((column) => [column.id, column]));

    return (
      <div className="space-y-2">
        <div className="flex justify-end">
          <ColumnChooser
            columns={order.flatMap((id) => {
              const column = byId.get(id);
              return column ? [{ id, label: labels[id] ?? id, locked: id === 'name' }] : [];
            })}
            visible={visible}
            onVisibleChange={setVisible}
            onReorder={setOrder}
          />
        </div>
        <DataTable<Person>
          label="People"
          rows={people}
          rowId={(person) => person.id}
          columns={order.flatMap((id) => {
            const column = byId.get(id);
            return column && visible.includes(id) ? [column] : [];
          })}
        />
      </div>
    );
  },
};
