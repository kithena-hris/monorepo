import { Avatar, ListItem, Stack, Text, VirtualList } from '@reach/ui-native';

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
