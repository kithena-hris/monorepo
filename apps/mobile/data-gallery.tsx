import { useState } from 'react';

import {
  Avatar,
  BulkAction,
  DataTable,
  ListItem,
  move,
  Stack,
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
      <PeopleTable />
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
