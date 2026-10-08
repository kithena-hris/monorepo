import { Badge, List, ListItem, SearchField, Text } from '@reach/ui-native';
import { ArrowLeftRight, ListChecks, Network, Users } from 'lucide-react-native';
import { useState } from 'react';

import { Page } from '../frame';
import { useRead } from './api';
import type { PeopleScreen } from './routes';

/**
 * The People tab (design A1): one search straight into the Directory, then the
 * sections, one row each. A section joins this list when the phone can do it.
 */
export function PeopleHome({ navigation }: PeopleScreen<'People'>): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { load } = useRead<number | null>('Headcount');
  const headcount = load.status === 'ready' ? load.data : null;
  // What waits for this viewer, as the shell's bell counts it: Review's one red count.
  const counts = useRead<Readonly<Record<string, number | null>>>('Waiting').load;
  const waiting =
    counts.status === 'ready'
      ? ['changes', 'identifiers', 'duplicates', 'accessRequests', 'exports'].reduce(
          (sum, key) => sum + (counts.data[key] ?? 0),
          0,
        )
      : null;

  return (
    <Page large="People">
      <SearchField
        value={search}
        onValueChange={setSearch}
        placeholder={headcount === null ? 'Search people' : `Search ${String(headcount)} people`}
        label="Search people"
        onSearch={(value) => {
          if (value.trim() === '') return;
          navigation.navigate('Directory', { search: value.trim() });
          setSearch('');
        }}
      />
      <List>
        <ListItem
          icon={Users}
          description="Everyone, as a list"
          chevron
          onPress={() => {
            navigation.navigate('Directory');
          }}
        >
          Directory
        </ListItem>
        <ListItem
          icon={ListChecks}
          description={
            waiting === null || waiting === 0
              ? 'Every decision and missing detail, in one queue'
              : `${String(waiting)} waiting for you`
          }
          {...(waiting === null || waiting === 0
            ? { chevron: true }
            : {
                trailing: (
                  <Badge size="sm" tone="danger" variant="solid">
                    {String(waiting)}
                  </Badge>
                ),
              })}
          onPress={() => {
            navigation.navigate('Review');
          }}
        >
          Review
        </ListItem>
        <ListItem
          icon={ArrowLeftRight}
          description="Bring people in, take data out"
          chevron
          onPress={() => {
            navigation.navigate('ImportExport');
          }}
        >
          Import & export
        </ListItem>
        <ListItem
          icon={Network}
          description="Who reports to whom"
          chevron
          onPress={() => {
            navigation.navigate('OrgChart');
          }}
        >
          Org chart
        </ListItem>
      </List>
      <Text variant="subhead" tone="subtle">
        Your own profile is in the Me tab.
      </Text>
    </Page>
  );
}
