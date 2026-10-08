import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ChipGroup,
  ChipGroupItem,
  EmptyState,
  Icon,
  ListItem,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  VirtualList,
} from '@reach/ui-native';
import { ListChecks, SearchX, SlidersHorizontal, UserPlus } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from './act';
import { AddPersonDialog } from './add-person';
import { ask, useSigned } from './api';
import type { Condition, DirectoryField } from './filters';
import { PersonAvatar } from './media';
import { parsed } from './review/load';
import { useRoles } from './roles';
import type { PeopleScreen } from './routes';
import {
  Conditions,
  FiltersDialog,
  NeedsYou,
  planOf,
  rememberReading,
  SaveViewDialog,
  type Plan,
} from './smart-search';

/** One page of `peopleDirectory`, as much of it as the phone draws. */
interface DirectoryPage {
  readonly total: number;
  readonly notStarted: number | null;
  readonly leaving: number | null;
  readonly incomplete: number | null;
  readonly columns: readonly { readonly key: string; readonly shown: boolean }[];
  readonly fields: readonly DirectoryField[] | null;
  readonly segments: readonly { readonly id: string; readonly name: string }[] | null;
  /** The fields "Remind all" asks for, after a question about empty ones; null otherwise. */
  readonly remind: readonly string[] | null;
  readonly can: { readonly bulkEdit: boolean } | null;
  readonly people: readonly DirectoryPerson[];
  readonly next: string | null;
}

interface DirectoryPerson {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly values: readonly { readonly key: string; readonly value: string }[];
  readonly people: readonly { readonly key: string }[] | null;
}

/** What narrows the list: conditions, their order, a saved view, or the incomplete records. */
interface Query {
  readonly conditions: readonly Condition[];
  readonly match: 'all' | 'any';
  readonly sort: string | null;
  readonly top: number | null;
  readonly incomplete: boolean;
  readonly segment: string | null;
}

const EVERYONE: Query = {
  conditions: [],
  match: 'all',
  sort: null,
  top: null,
  incomplete: false,
  segment: null,
};
const status = (value: string): Query => ({
  ...EVERYONE,
  conditions: [{ key: 'status', op: 'in', values: [value] }],
});

/** The web's views (`Views` in the Directory), each a query People applies. */
const VIEWS: Readonly<Record<string, Query>> = {
  everyone: EVERYONE,
  starting: status('pre_hire'),
  leaving: status('notice'),
  incomplete: { ...EVERYONE, incomplete: true },
};

/** Which view chip a query is, or '' when it is conditions of somebody's own. */
function viewOf(query: Query): string {
  if (query.segment !== null) return `segment:${query.segment}`;
  const same = Object.entries(VIEWS).find(
    ([, v]) => JSON.stringify(v) === JSON.stringify({ ...query, sort: null, top: null }),
  );
  return query.sort === null && query.top === null ? (same?.[0] ?? '') : '';
}

/** What a question left to show beside its chips. */
interface Asked {
  readonly unused: readonly string[];
  readonly notes: readonly string[];
  readonly ask: Plan['ask'];
  readonly refused: Plan['refused'];
}

const peopleCount = (n: number): string => `${String(n)} ${n === 1 ? 'person' : 'people'}`;

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
 * The Directory (design C1–C3): always a list on a phone. One box for names
 * and questions: typing searches names, Enter asks, and the question becomes
 * the Directory's own conditions under "Understood as". The views and saved
 * views as a scrolling row, the filters centred, and pages loaded as the
 * list nears its end.
 */
export function Directory({ navigation, route }: PeopleScreen<'Directory'>): React.JSX.Element {
  const signed = useSigned();
  const [typed, setTyped] = useState(route.params?.search ?? '');
  const [search, setSearch] = useState(typed);
  const [query, setQuery] = useState<Query>(() =>
    route.params?.conditions === undefined
      ? EVERYONE
      : { ...EVERYONE, conditions: route.params.conditions },
  );
  const [question, setQuestion] = useState<Asked | null>(null);
  const [reading, setReading] = useState(false);
  const [unread, setUnread] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const [saving, setSaving] = useState(false);
  // People chosen for a bulk edit; null when not choosing.
  const [picked, setPicked] = useState<readonly string[] | null>(null);
  const { act, busy } = useAct();
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [page, setPage] = useState<DirectoryPage | null>(null);
  const [rows, setRows] = useState<readonly DirectoryPerson[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [height, setHeight] = useState(0);
  const [adding, setAdding] = useState(false);
  const { hr } = useRoles();
  // Answers to an older search or view are dropped, not drawn over a newer one.
  const asked = useRef(0);

  // A pause in typing a name is a search. A sentence waits for Enter, which asks.
  // ponytail: "a name is at most two words", a heuristic; the plan reads anything on Enter.
  const type = (text: string): void => {
    setTyped(text);
    clearTimeout(typing.current);
    if (question !== null) {
      setQuestion(null);
      setQuery(EVERYONE);
    }
    if (text.trim().split(/\s+/).length > 2) return;
    typing.current = setTimeout(() => {
      setSearch(text.trim());
    }, 300);
  };

  const askIt = async (sentence: string): Promise<void> => {
    clearTimeout(typing.current);
    const text = sentence.trim();
    setUnread(null);
    if (text === '') {
      setQuestion(null);
      setSearch('');
      setQuery(EVERYONE);
      return;
    }
    setReading(true);
    const got = await planOf(signed, text);
    setReading(false);
    if (!got.ok) {
      setUnread(`“${text}” could not be read: ${got.message}`);
      return;
    }
    const plan = got.plan;
    if (plan.person !== null) {
      navigation.navigate('Profile', {
        personId: plan.person.id,
        name: plan.person.name,
        back: 'Directory',
      });
      return;
    }
    if (plan.by === 'search') {
      setQuestion(null);
      setQuery(EVERYONE);
      setSearch(plan.search ?? text);
      return;
    }
    setSearch(plan.search ?? '');
    setQuery({
      conditions: plan.conditions,
      match: plan.match === 'any' ? 'any' : 'all',
      // Grouped, People orders by the group; a question's results otherwise come by name.
      // ponytail: grouped as an order, without headings between the groups.
      sort:
        plan.group !== null
          ? `${plan.group}:asc`
          : (plan.sort ?? (plan.conditions.length > 0 ? 'name:asc' : null)),
      top: plan.top,
      incomplete: false,
      segment: null,
    });
    setQuestion({
      unused: plan.unused,
      notes: [
        plan.note,
        ...plan.notes,
        plan.remembered === null
          ? null
          : `Read “${plan.remembered.phrase}” as ${plan.remembered.label.toLowerCase()}, as you chose before.`,
      ].filter((n): n is string => n !== null),
      ask: plan.ask,
      refused: plan.refused,
    });
  };

  const variables = useCallback(
    (after: string | null) => ({
      search: search === '' ? null : search,
      conditions: query.conditions.length === 0 ? null : query.conditions,
      match: query.match === 'any' ? 'any' : null,
      sort: query.sort,
      top: query.top,
      segment: query.segment,
      incomplete: query.incomplete ? true : null,
      after,
    }),
    [search, query],
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

  const view = viewOf(query);
  const counts = page === null || view !== 'everyone' || search !== '' ? null : page;
  const fields = page?.fields ?? [];
  const statuses = page?.fields?.some((f) => f.key === 'status') ?? true;
  const remind = page?.remind ?? null;
  const canRemind = question !== null && remind !== null && (page?.total ?? 0) > 0;
  const remindAll = (): void => {
    if (remind === null) return;
    const what = remind
      .map((k) => (fields.find((f) => f.key === k)?.label ?? k).toLowerCase())
      .join(' and ');
    void act<string>(
      'RemindDirectory',
      {
        conditions: JSON.stringify(query.conditions),
        match: query.match,
        search: search === '' ? null : search,
      },
      (data) => {
        const done = parsed(data) as { asked: number; more: boolean } | null;
        return done === null
          ? 'Reminded'
          : `Asked ${peopleCount(done.asked)} for their ${what}.${done.more ? ' That is the first 500; remind again for the rest.' : ''}`;
      },
    );
  };

  return (
    <Page
      title="Directory"
      back={{ label: 'People', onPress: navigation.goBack }}
      scroll={false}
      // After a question about empty fields, Remind all is in thumb reach (design C2).
      {...(picked !== null
        ? {
            foot: (
              <>
                <Button
                  className="flex-1"
                  onPress={() => {
                    setPicked(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  variant="primary"
                  disabled={picked.length === 0}
                  onPress={() => {
                    navigation.navigate('BulkEdit', { personIds: [...picked] });
                    setPicked(null);
                  }}
                >
                  {`Edit ${String(picked.length)}`}
                </Button>
              </>
            ),
          }
        : canRemind
          ? {
              foot: (
                <>
                  <Text tone="muted" className="flex-1 self-center">
                    {peopleCount(page?.total ?? 0)}
                  </Text>
                  <Button
                    className="flex-1"
                    loading={busy === 'RemindDirectory'}
                    onPress={remindAll}
                  >
                    Remind all
                  </Button>
                </>
              ),
            }
          : {})}
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
      {filtering ? (
        <FiltersDialog
          fields={fields}
          conditions={query.conditions}
          match={query.match}
          onApply={(conditions, match) => {
            setQuery({ ...EVERYONE, conditions, match, sort: query.sort });
          }}
          onClose={() => {
            setFiltering(false);
          }}
        />
      ) : null}
      {saving ? (
        <SaveViewDialog
          conditions={query.conditions}
          match={query.match}
          onSaved={(id) => {
            setSaving(false);
            setQuestion(null);
            setTyped('');
            setSearch('');
            setQuery({ ...EVERYONE, segment: id });
          }}
          onClose={() => {
            setSaving(false);
          }}
        />
      ) : null}
      <SearchField
        value={typed}
        onValueChange={type}
        onSearch={(value) => void askIt(value)}
        placeholder="Ask, or type a name"
        label="Search people"
      />
      {reading ? <Loading label="Reading the question" /> : null}
      {unread === null ? null : (
        <Alert tone="danger" title="Not understood">
          {unread}
        </Alert>
      )}
      {/* A box of its own: a sideways scroller in a column otherwise takes a share of its height. */}
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <ChipGroup
            type="single"
            value={view}
            onValueChange={(value) => {
              setQuestion(null);
              setQuery(
                value.startsWith('segment:')
                  ? { ...EVERYONE, segment: value.slice('segment:'.length) }
                  : (VIEWS[value] ?? EVERYONE),
              );
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
            {(page?.segments ?? []).map((segment) => (
              <ChipGroupItem key={segment.id} value={`segment:${segment.id}`} variant="view">
                {segment.name}
              </ChipGroupItem>
            ))}
          </ChipGroup>
        </View>
        {page?.can?.bulkEdit === true ? (
          <Button
            size="sm"
            variant="ghost"
            startIcon={<Icon icon={ListChecks} />}
            accessibilityLabel="Choose people to edit together"
            onPress={() => {
              setPicked((p) => (p === null ? [] : null));
            }}
          />
        ) : null}
        {fields.length === 0 ? null : (
          <Button
            size="sm"
            variant="ghost"
            startIcon={<Icon icon={SlidersHorizontal} />}
            accessibilityLabel="Filter people"
            onPress={() => {
              setFiltering(true);
            }}
          />
        )}
      </View>
      {/* What a question left to settle scrolls on its own, so the list keeps its share. */}
      <ScrollView style={{ flexGrow: 0, maxHeight: '50%' }} contentContainerClassName="gap-3">
        {question === null ? null : (
          <NeedsYou
            refused={question.refused}
            asked={question.ask}
            onPick={(reading) => {
              if (question.ask?.topic != null)
                void rememberReading(question.ask.topic, reading.label);
              setQuestion({ ...question, ask: null });
              setQuery({ ...query, conditions: reading.conditions, match: reading.match });
            }}
            onUse={(refusal) => {
              setQuestion({ ...question, refused: question.refused.filter((r) => r !== refusal) });
              if (refusal.instead !== null) {
                setQuery({
                  ...query,
                  conditions: [...query.conditions, refusal.instead.condition],
                });
              }
            }}
            onRemove={(refusal) => {
              setQuestion({ ...question, refused: question.refused.filter((r) => r !== refusal) });
            }}
          />
        )}
        {view !== '' && question === null ? null : (
          <Conditions
            fields={fields}
            conditions={query.conditions}
            understood={question !== null}
            unused={question?.unused ?? []}
            notes={question?.notes ?? []}
            onRemove={(index) => {
              setQuery({ ...query, conditions: query.conditions.filter((_, i) => i !== index) });
            }}
            onDropUnused={(text) => {
              if (question !== null)
                setQuestion({ ...question, unused: question.unused.filter((u) => u !== text) });
            }}
            onEdit={() => {
              setFiltering(true);
            }}
            {...(query.conditions.length === 0
              ? {}
              : {
                  onSave: () => {
                    setSaving(true);
                  },
                })}
          />
        )}
      </ScrollView>
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
                  leading={
                    picked !== null ? (
                      <Checkbox
                        checked={picked.includes(person.id)}
                        accessibilityLabel={`Choose ${person.name}`}
                        onCheckedChange={(on) => {
                          setPicked((p) =>
                            p === null
                              ? p
                              : on
                                ? [...p, person.id]
                                : p.filter((id) => id !== person.id),
                          );
                        }}
                      />
                    ) : (
                      <PersonAvatar
                        personId={person.id}
                        name={person.name}
                        avatarUrl={person.avatarUrl}
                        size={44}
                      />
                    )
                  }
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
                    if (picked !== null) {
                      setPicked((p) =>
                        p === null
                          ? p
                          : p.includes(person.id)
                            ? p.filter((id) => id !== person.id)
                            : [...p, person.id],
                      );
                      return;
                    }
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
