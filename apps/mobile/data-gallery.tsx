import { useState } from 'react';

import {
  Avatar,
  AppliedFilters,
  BulkAction,
  ColumnChooser,
  type ColumnChooserValue,
  DataTable,
  FilterBuilder,
  type FilterGroup,
  KeyValues,
  ListItem,
  Money,
  move,
  Stack,
  Stat,
  TableTitle,
  Text,
  VirtualList,
} from '@reach/ui-native';

const NAMES = ['Priya Shah', 'Jonas Weber', 'Amara Okafor', 'Lucas Moreau', 'Mei Tanaka'];
const ROWS = Array.from({ length: 20_000 }, (_, id) => ({
  id,
  name: NAMES[id % NAMES.length] ?? 'Priya Shah',
}));

/** The data components, as a device draws them: FlashList recycling natively. */
export function DataGallery(): React.JSX.Element {
  return (
    <Stack gap={2}>
      <Text variant="headline">Data</Text>
      <Stat label="Headcount" value="312" delta="+12 this quarter" sentiment="positive" />
      <KeyValues
        items={[
          { label: 'Team', value: 'Engineering' },
          {
            label: 'Salary',
            value: <Money minorUnits="900719925474099" currency="EUR" locale="en-GB" />,
          },
        ]}
      />
      <PeopleTable />
      <Filters />
      <VirtualList
        items={ROWS}
        label="Everyone"
        height={280}
        itemKey={(row) => String(row.id)}
        renderItem={(row) => (
          <ListItem
            listitem={false}
            className="min-h-[52px]"
            leading={<Avatar name={row.name} size={28} decorative />}
            description={`#${String(row.id + 1)}`}
          >
            {row.name}
          </ListItem>
        )}
      />
    </Stack>
  );
}

const TEAM = NAMES.map((name, i) => ({ name, team: ['Engineering', 'Design', 'Sales', 'Finance', 'People'][i] ?? '' }));
type Member = (typeof TEAM)[number];

/** A table as cards: select, reorder by long-press, a bulk bar. */
function PeopleTable(): React.JSX.Element {
  const [rows, setRows] = useState<Member[]>(TEAM);
  return (
    <DataTable
      label="People"
      rows={rows}
      rowId={(p) => p.name}
      columns={[
        { id: 'name', header: 'Name', cell: (p) => <TableTitle title={p.name} avatar={p.name} /> },
        { id: 'team', header: 'Team', cell: (p) => p.team },
      ]}
      selectable
      bulkActions={() => <BulkAction>Export</BulkAction>}
      onReorder={({ from, to }) => {
        setRows(move(rows, from, to));
      }}
    />
  );
}

const FIELDS = [
  {
    id: 'team',
    label: 'Team',
    operators: [{ id: 'is', label: 'is', value: 'option' as const }],
    options: ['Engineering', 'Design', 'Sales'].map((t) => ({ value: t, label: t })),
  },
  {
    id: 'start',
    label: 'Start date',
    operators: [{ id: 'after', label: 'is after', value: 'date' as const }],
  },
];

/** A filter builder, its applied chips, and the column chooser. */
function Filters(): React.JSX.Element {
  const [filter, setFilter] = useState<FilterGroup>({
    match: 'all',
    conditions: [{ id: 'c1', field: 'team', operator: 'is', values: ['Engineering'] }],
  });
  const [columns, setColumns] = useState<ColumnChooserValue>({
    order: ['name', 'team', 'location'],
    visible: ['name', 'team'],
  });
  return (
    <Stack gap={2}>
      <FilterBuilder fields={FIELDS} value={filter} onChange={setFilter} applyLabel="Show 48 people" />
      <AppliedFilters
        filters={filter.conditions.map((c) => ({ id: c.id, field: c.field, label: c.values.join(', ') }))}
        onRemove={(id) => {
          setFilter({ ...filter, conditions: filter.conditions.filter((c) => c.id !== id) });
        }}
      />
      <ColumnChooser
        inline
        columns={[
          { id: 'name', label: 'Name', locked: true },
          { id: 'team', label: 'Team' },
          { id: 'location', label: 'Location' },
        ]}
        value={columns}
        onChange={setColumns}
      />
    </Stack>
  );
}
