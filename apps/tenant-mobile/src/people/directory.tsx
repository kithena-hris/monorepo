import {
  Avatar,
  Badge,
  Button,
  ChipGroup,
  ChipGroupItem,
  EmptyState,
  Icon,
  ListItem,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  VirtualList,
} from '@reach/ui-native';
import { SearchX, UserPlus } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { AddPersonDialog } from './add-person';
import { ask, useSigned } from './api';
import { useRoles } from './roles';
import type { PeopleScreen } from './routes';

/** One page of `peopleDirectory`, as much of it as the phone draws. */
interface DirectoryPage {
  readonly total: number;
  readonly notStarted: number | null;
  readonly leaving: number | null;
  readonly incomplete: number | null;
  readonly columns: readonly { readonly key: string; readonly shown: boolean }[];
  readonly fields: readonly { readonly key: string; readonly kind: string }[] | null;
  readonly people: readonly DirectoryPerson[];
  readonly next: string | null;
}

interface DirectoryPerson {
  readonly id: string;
  readonly name: string;
  readonly values: readonly { readonly key: string; readonly value: string }[];
  readonly people: readonly { readonly key: string }[] | null;
}

/** The web's views (`Views` in the Directory), each a condition People applies. */
const VIEWS = {
  everyone: {},
  starting: { conditions: [{ key: 'status', op: 'in', values: ['pre_hire'] }] },
  leaving: { conditions: [{ key: 'status', op: 'in', values: ['notice'] }] },
  incomplete: { incomplete: true },
} as const;
type View_ = keyof typeof VIEWS;

export const STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'info'> = {
  Active: 'success',
  'On leave': 'info',
  'On notice': 'warning',
  'Starting soon': 'info',
};

/**
 * "Backend engineer · Madrid": the first two columns People shows, in words,
 * as the web's list line. Not the status (a badge says it), not a person (a
 * manager is a link on the web), not a date.
 */
function lineOf(page: DirectoryPage, person: DirectoryPerson): string {
  const values = new Map(person.values.map((v) => [v.key, v.value]));
  return page.columns
    .filter(
      (c) => c.shown && c.key !== 'status' && person.people?.some((r) => r.key === c.key) !== true,
    )
    .map((c) => values.get(c.key))
    .filter((v): v is string => v !== undefined && v !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v))
    .slice(0, 2)
    .join(' · ');
}

/** A view's name, with its count where People gave one. */
const label = (name: string, count: number | null | undefined): string =>
  count == null ? name : `${name} ${String(count)}`;

/**
 * The Directory (design C1): always a list on a phone. One search box, the
 * views as a scrolling row, and pages loaded as the list nears its end.
 */
export function Directory({ navigation, route }: PeopleScreen<'Directory'>): React.JSX.Element {
  const signed = useSigned();
  const [typed, setTyped] = useState(route.params?.search ?? '');
  const [search, setSearch] = useState(typed);
  const [view, setView] = useState<View_>('everyone');
  const [page, setPage] = useState<DirectoryPage | null>(null);
  const [rows, setRows] = useState<readonly DirectoryPerson[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [height, setHeight] = useState(0);
  const [adding, setAdding] = useState(false);
  const { hr } = useRoles();
  // Answers to an older search or view are dropped, not drawn over a newer one.
  const asked = useRef(0);

  // A pause in typing is a search, as on the web.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(typed.trim());
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);

  const variables = useCallback(
    (after: string | null) => ({
      ...VIEWS[view],
      search: search === '' ? null : search,
      after,
    }),
    [search, view],
  );

  const first = useCallback(async () => {
    const round = ++asked.current;
    setFailed(null);
    setPage(null);
    const answer = await ask<DirectoryPage>(signed, 'Directory', variables(null));
    if (round !== asked.current) return;
    if (!answer.ok) {
      setFailed(answer.message);
      return;
    }
    setPage(answer.data);
    setRows(answer.data.people);
  }, [signed, variables]);

  useEffect(() => {
    void first();
  }, [first]);

  const next = async (): Promise<void> => {
    if (page?.next == null || more) return;
    const round = asked.current;
    setMore(true);
    const answer = await ask<DirectoryPage>(signed, 'Directory', variables(page.next));
    setMore(false);
    if (round !== asked.current || !answer.ok) return;
    setPage(answer.data);
    setRows((held) => [...held, ...answer.data.people]);
  };

  const counts = page === null || view !== 'everyone' || search !== '' ? null : page;
  const statuses = page?.fields?.some((f) => f.key === 'status') ?? true;

  return (
    <Page
      title="Directory"
      back={{ label: 'People', onPress: navigation.goBack }}
      scroll={false}
      // Add person is the icon at the top right, for HR (design C1).
      {...(hr
        ? {
            trailing: (
              <Button
                size="sm"
                startIcon={<Icon icon={UserPlus} />}
                accessibilityLabel="Add a person"
                onPress={() => {
                  setAdding(true);
                }}
              />
            ),
          }
        : {})}
    >
      <AddPersonDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={(personId, name) => {
          navigation.navigate('Profile', { personId, name, back: 'Directory' });
        }}
      />
      <SegmentedControl
        value="list"
        fullWidth
        accessibilityLabel="Show people as"
        onValueChange={(value) => {
          if (value === 'org-chart') navigation.replace('OrgChart');
        }}
      >
        <SegmentedControlItem value="list">List</SegmentedControlItem>
        <SegmentedControlItem value="org-chart">Org chart</SegmentedControlItem>
      </SegmentedControl>
      <SearchField
        value={typed}
        onValueChange={setTyped}
        onSearch={(value) => {
          setSearch(value.trim());
        }}
        placeholder="Type a name"
        label="Search people"
      />
      {/* A box of its own: a sideways scroller in a column otherwise takes a share of its height. */}
      <View>
        <ChipGroup
          type="single"
          value={view}
          onValueChange={(value) => {
            setView(value as View_);
          }}
          accessibilityLabel="Views"
          scroll
        >
          <ChipGroupItem value="everyone" variant="view">
            {label('Everyone', counts?.total)}
          </ChipGroupItem>
          {statuses ? (
            <ChipGroupItem value="starting" variant="view">
              {label('Starting soon', counts?.notStarted)}
            </ChipGroupItem>
          ) : null}
          {statuses ? (
            <ChipGroupItem value="leaving" variant="view">
              {label('Leaving', counts?.leaving)}
            </ChipGroupItem>
          ) : null}
          {page?.incomplete === null ? null : (
            <ChipGroupItem value="incomplete" variant="view">
              {label('Incomplete', counts?.incomplete)}
            </ChipGroupItem>
          )}
        </ChipGroup>
      </View>

      <View
        className="flex-1"
        onLayout={(event) => {
          setHeight(event.nativeEvent.layout.height);
        }}
      >
        {failed !== null ? (
          <Failed message={failed} onRetry={() => void first()} />
        ) : page === null ? (
          <Loading label="Loading people" />
        ) : height === 0 ? null : (
          <VirtualList
            items={rows}
            label="People"
            height={height}
            itemKey={(person) => person.id}
            onEndReached={() => void next()}
            loadingMore={more}
            moreLoaded={(added) => `${String(added)} more people`}
            empty={
              <EmptyState
                icon={SearchX}
                title="Nobody matches"
                description="Change the search or the view to see more people."
              />
            }
            renderItem={(person) => {
              const status = person.values.find((v) => v.key === 'status')?.value;
              const line = lineOf(page, person);
              return (
                <ListItem
                  listitem={false}
                  leading={<Avatar name={person.name} size={44} decorative />}
                  {...(line === '' ? {} : { description: line })}
                  {...(status === undefined || status === 'Active'
                    ? { chevron: true }
                    : {
                        trailing: (
                          <Badge size="sm" dot tone={STATUS_TONE[status] ?? 'neutral'}>
                            {status}
                          </Badge>
                        ),
                      })}
                  onPress={() => {
                    navigation.navigate('Profile', {
                      personId: person.id,
                      name: person.name,
                      back: 'Directory',
                    });
                  }}
                >
                  {person.name}
                </ListItem>
              );
            }}
          />
        )}
      </View>
    </Page>
  );
}
