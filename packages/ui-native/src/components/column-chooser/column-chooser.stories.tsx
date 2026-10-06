import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Columns3 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native-css/components';

import { designDocs } from '../../docs/design.ts';
import { settled } from '../../docs/stage.tsx';
import { PEOPLE } from '../../docs/people.ts';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover.tsx';
import { DataTable, TableTitle, type DataColumn } from '../table/table.tsx';
import { ColumnChooser, orderColumns, type ColumnChooserValue } from './column-chooser.tsx';

const COLUMNS = [
  { id: 'name', label: 'Name', locked: true },
  { id: 'team', label: 'Team' },
  { id: 'location', label: 'Location' },
  { id: 'status', label: 'Status' },
  { id: 'start', label: 'Start date' },
  { id: 'manager', label: 'Manager' },
  { id: 'salary', label: 'Salary' },
  { id: 'employee-id', label: 'Employee ID' },
];
const DEFAULT: ColumnChooserValue = {
  order: COLUMNS.map((c) => c.id),
  visible: ['name', 'team', 'location', 'status', 'start'],
};

const meta = {
  title: 'Components/ColumnChooser',
  component: ColumnChooser,
  parameters: designDocs('column-chooser'),
  args: { columns: COLUMNS, value: DEFAULT, onChange: () => undefined },
} satisfies Meta<typeof ColumnChooser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function PlaygroundStory() {
    const [value, setValue] = useState(DEFAULT);
    return (
      <ColumnChooser
        inline
        columns={COLUMNS}
        value={value}
        onChange={setValue}
        onReset={() => {
          setValue(DEFAULT);
        }}
        className="w-[280px]"
      />
    );
  },
};

type Person = (typeof PEOPLE)[number];
const MANAGERS = ['Jonas Weber', 'Nora Becker', 'Jonas Weber', 'Tom Fischer'];
const CELLS: Record<string, DataColumn<Person>> = {
  name: {
    id: 'name',
    header: 'Name',
    cell: (p) => <TableTitle title={p.name} description={p.role} avatar={p.name} />,
  },
  team: { id: 'team', header: 'Team', cell: (p) => p.team },
  location: { id: 'location', header: 'Location', cell: (p) => p.location },
  manager: {
    id: 'manager',
    header: 'Manager',
    cell: (p) => MANAGERS[PEOPLE.indexOf(p)] ?? '',
  },
};
const SMALL = COLUMNS.filter((c) => c.id in CELLS);

export const DrivingATable: Story = {
  name: 'Driving a table',
  play: settled,
  render: function DrivingStory() {
    const start = { order: SMALL.map((c) => c.id), visible: ['name', 'team', 'manager'] };
    const [value, setValue] = useState<ColumnChooserValue>(start);
    const [open, setOpen] = useState(false);
    const columns = orderColumns(SMALL, value.order)
      .filter((c) => c.locked || value.visible.includes(c.id))
      .flatMap((c) => (CELLS[c.id] ? [CELLS[c.id] as DataColumn<Person>] : []));
    return (
      <View className="gap-2">
        <View className="items-end">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger>
              <Button variant="tinted" size="sm" startIcon={<Icon icon={Columns3} />}>
                Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent label="Columns" align="end" className="w-[280px]">
              <ColumnChooser
                columns={SMALL}
                value={value}
                onChange={setValue}
                onReset={() => {
                  setValue(start);
                }}
                onDone={() => {
                  setOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </View>
        <DataTable
          label="People"
          rows={PEOPLE.slice(0, 4)}
          columns={columns}
          rowId={(p) => p.name}
          onRowPress={() => undefined}
        />
      </View>
    );
  },
};
