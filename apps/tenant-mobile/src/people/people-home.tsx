import { List, ListItem, SearchField, Text } from '@reach/ui-native';
import { Network, Users } from 'lucide-react-native';
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
