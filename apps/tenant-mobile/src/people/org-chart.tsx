import {
  Avatar,
  EmptyState,
  List,
  ListItem,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  TreeView,
  type TreeViewNode,
} from '@reach/ui-native';
import { SearchX } from 'lucide-react-native';
import { useMemo, useState } from 'react';

import { Failed, Loading, Page } from '../frame';
import { useRead } from './api';
import { orgTree, type OrgNode, type OrgPerson } from './org';
import type { PeopleScreen } from './routes';

interface OrgChartData {
  readonly people: readonly OrgPerson[];
  readonly truncated: boolean;
}

/** The tree, as Reach's `TreeView` draws it: a face, a name, how many report. */
function nodeOf({ person, reports }: OrgNode): TreeViewNode {
  return {
    id: person.id,
    label: person.name,
    icon: <Avatar name={person.name} size={28} decorative />,
    ...(reports.length === 0
      ? {}
      : {
          children: reports.map(nodeOf),
          meta: <Text tone="muted">{String(reports.length)}</Text>,
        }),
  };
}

/**
 * The org chart (design C4): a folding tree, the top of it open. Tapping a
 * person opens their profile; a search lists who matches instead.
 */
export function OrgChart({ navigation }: PeopleScreen<'OrgChart'>): React.JSX.Element {
  const { load, reload } = useRead<OrgChartData>('OrgChart');
  const [search, setSearch] = useState('');
  const people = load.status === 'ready' ? load.data.people : [];
  const tree = useMemo(() => orgTree(people).map(nodeOf), [people]);
  const open = (id: string): void => {
    const person = people.find((p) => p.id === id);
    navigation.navigate('Profile', {
      personId: id,
      ...(person === undefined ? {} : { name: person.name }),
      back: 'Org chart',
    });
  };
  const query = search.trim().toLowerCase();
  const matches =
    query === ''
      ? []
      : people.filter(
          (p) => p.name.toLowerCase().includes(query) || p.title?.toLowerCase().includes(query),
        );

  return (
    <Page title="Org chart" back={{ label: 'People', onPress: navigation.goBack }}>
      <SegmentedControl
        value="org-chart"
        fullWidth
        accessibilityLabel="Show people as"
        onValueChange={(value) => {
          if (value === 'list') navigation.replace('Directory');
        }}
      >
        <SegmentedControlItem value="list">List</SegmentedControlItem>
        <SegmentedControlItem value="org-chart">Org chart</SegmentedControlItem>
      </SegmentedControl>
      <SearchField
        value={search}
        onValueChange={setSearch}
        placeholder="Find a person or title"
        label="Find a person"
      />
      {load.status === 'loading' ? (
        <Loading label="Loading the org chart" />
      ) : load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : query !== '' ? (
        matches.length === 0 ? (
          <EmptyState icon={SearchX} title="Nobody matches" />
        ) : (
          <List>
            {matches.map((p) => (
              <ListItem
                key={p.id}
                leading={<Avatar name={p.name} size={40} decorative />}
                {...(p.title === null ? {} : { description: p.title })}
                chevron
                onPress={() => {
                  open(p.id);
                }}
              >
                {p.name}
              </ListItem>
            ))}
          </List>
        )
      ) : (
        <>
          <TreeView
            items={tree}
            label="Org chart"
            defaultExpanded={tree.map((n) => n.id)}
            onSelectedChange={open}
          />
          {load.data.truncated ? (
            <Text variant="footnote" tone="muted">
              Only part of the company is shown here. Search for anybody not in it.
            </Text>
          ) : null}
        </>
      )}
    </Page>
  );
}
