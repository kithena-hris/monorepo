import {
  Alert,
  AvatarGroup,
  Badge,
  Button,
  Card,
  Checkbox,
  ChipGroup,
  ChipGroupItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  ListItem,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Stat,
  Text,
  TreeView,
  type TreeViewNode,
  VirtualList,
} from '@reach/ui-native';
import { dateFormat, locale } from '@reach/ui-native/words';
import {
  ChartColumn,
  Copy,
  Download,
  Ellipsis,
  ListChecks,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UserPlus,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from './act';
import { AddPersonDialog } from './add-person';
import { ask, useRead, useSigned } from './api';
import type { Condition, DirectoryField } from './filters';
import { PersonAvatar } from './media';
import { orgTree, type OrgNode, type OrgPerson } from './org';
import { ReviewCard } from './review/review-card';
import { ExportDialog } from './transfer/export-dialog';
import { ImportDialog } from './transfer/import-dialog';
import { parsed } from './review/load';
import { useRoles } from './roles';
import type { PeopleScreen } from './routes';
import {
  ChipFiltersDialog,
  Conditions,
  FiltersDialog,
  NeedsYou,
  planOf,
  rememberReading,
  SaveViewDialog,
  type Plan,
} from './smart-search';
import { t } from '../i18n';

/** One page of `peopleDirectory`, as much of it as the phone draws. */
export interface DirectoryPage {
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
  readonly missing: number | null;
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
function viewOf(query: Query, team: Query | null): string {
  if (query.segment !== null) return `segment:${query.segment}`;
  const plain = JSON.stringify({ ...query, sort: null, top: null });
  if (team !== null && plain === JSON.stringify(team)) return 'team';
  const same = Object.entries(VIEWS).find(([, v]) => JSON.stringify(v) === plain);
  return query.sort === null && query.top === null ? (same?.[0] ?? '') : '';
}

/** What a question left to show beside its chips. */
interface Asked {
  readonly sentence: string;
  readonly unused: readonly string[];
  readonly notes: readonly string[];
  readonly ask: Plan['ask'];
  readonly refused: Plan['refused'];
}

const peopleCount = (n: number): string =>
  t(
    'people.people-tab.people',
    { one: '{{count}} person', other: '{{count}} people' },
    { count: n },
  );

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

interface Figures {
  readonly headcount: { value: number; change: number | null } | null;
  readonly complete: { percent: number; incomplete: number } | null;
}

interface Starter {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly start: string | null;
  readonly missing: number | null;
}

/** "Mei on 1 Nov · Yuki on 2 Nov · 7 details missing". */
const short = dateFormat({ day: 'numeric', month: 'short', timeZone: 'UTC' });
function startersLine(starters: readonly Starter[]): string {
  const days = starters
    .slice(0, 2)
    .map((s) =>
      s.start === null
        ? (s.name.split(' ')[0] ?? s.name)
        : `${s.name.split(' ')[0] ?? s.name} on ${short.format(Date.parse(`${s.start}T00:00:00Z`))}`,
    );
  const missing = starters.reduce((n, s) => n + (s.missing ?? 0), 0);
  return [...days, missing === 0 ? 'ready' : `${String(missing)} details missing`].join(' · ');
}

/** "2 start in November", when they all start in one month. */
function startersTitle(starters: readonly Starter[]): string {
  const months = new Set(starters.map((s) => s.start?.slice(0, 7) ?? ''));
  const first = starters[0]?.start;
  if (months.size === 1 && first != null) {
    const month = dateFormat({ month: 'long', timeZone: 'UTC' }).format(
      Date.parse(`${first}T00:00:00Z`),
    );
    return `${String(starters.length)} start in ${month}`;
  }
  return `${String(starters.length)} starting soon`;
}

/** The org chart in place of the list (P6), read only once somebody turns to it. */
function OrgTree({
  myId,
  onOpen,
}: {
  myId: string | null;
  onOpen: (id: string, name: string | undefined) => void;
}): React.JSX.Element {
  const org = useRead<{ people: readonly OrgPerson[]; truncated: boolean }>('OrgChart');
  const tree = useMemo(
    () => (org.load.status === 'ready' ? orgTree(org.load.data.people).map(nodeOf) : []),
    [org.load],
  );
  if (org.load.status === 'loading')
    return (
      <Loading label={t('people.people-tab.loading_the_org_chart', 'Loading the org chart')} />
    );
  if (org.load.status === 'error')
    return <Failed message={org.load.message} onRetry={org.reload} />;
  const people = org.load.data.people;
  return (
    <>
      <Card padded={false} className="overflow-hidden py-1">
        <TreeView
          items={tree}
          label={t('people.people-tab.org_chart', 'Org chart')}
          defaultExpanded={tree.map((n) => n.id)}
          {...(myId === null ? {} : { defaultSelected: myId })}
          onSelectedChange={(id) => {
            onOpen(id, people.find((p) => p.id === id)?.name);
          }}
        />
      </Card>
      {org.load.data.truncated ? (
        <Text variant="footnote" tone="muted">
          {t(
            'people.people-tab.only_part_of_the_company_is',
            'Only part of the company is shown here. Search for anybody not in it.',
          )}
        </Text>
      ) : null}
    </>
  );
}

/** The tree, as Reach's `TreeView` draws it: a face, a name, a title, how many report. */
function nodeOf({ person, reports }: OrgNode): TreeViewNode {
  return {
    id: person.id,
    label: person.name,
    ...(person.title === null ? {} : { description: person.title }),
    icon: (
      <PersonAvatar
        personId={person.id}
        name={person.name}
        avatarUrl={person.avatarUrl}
        size={32}
      />
    ),
    ...(reports.length === 0
      ? {}
      : {
          children: reports.map(nodeOf),
          meta: <Text tone="muted">{String(reports.length)}</Text>,
        }),
  };
}

/**
 * The People tab (design v3 P1–P7): one scroll and no menu of sections. A
 * search that takes names or questions; for HR what needs them, decided in
 * place, who is starting, and two numbers; then everyone, as a list or an
 * org chart, with view chips and filters. The rarer jobs (import, export,
 * insights, duplicates, sensitive access, settings) sit in one menu on the
 * bar, each a tap away.
 */
export function PeopleTab({ navigation, route }: PeopleScreen<'People'>): React.JSX.Element {
  const signed = useSigned();
  const { hr, admin } = useRoles();
  const [typed, setTyped] = useState(route.params?.search ?? '');
  const [search, setSearch] = useState(typed);
  const [query, setQuery] = useState<Query>(() =>
    route.params?.conditions === undefined
      ? EVERYONE
      : { ...EVERYONE, conditions: route.params.conditions },
  );
  const [shape, setShape] = useState<'list' | 'org'>(route.params?.view ?? 'list');
  const [question, setQuestion] = useState<Asked | null>(null);
  const [answerShown, setAnswerShown] = useState(true);
  const [reading, setReading] = useState(false);
  const [unread, setUnread] = useState<string | null>(null);
  const [filtering, setFiltering] = useState<'chips' | 'builder' | null>(null);
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
  const [moving, setMoving] = useState<'import' | 'export' | null>(null);
  const [figures, setFigures] = useState<Figures | null>(null);
  const [starters, setStarters] = useState<readonly Starter[]>([]);
  const counts = useRead<Readonly<Record<string, number | null>>>('Waiting').load;
  const me = useRead<{ me: { id: string } | null }>('Overview').load;
  const myId = me.status === 'ready' ? (me.data.me?.id ?? null) : null;
  // Answers to an older search or view are dropped, not drawn over a newer one.
  const asked = useRef(0);

  // A link here with conditions or a search (Insights, an import) opens on them.
  useEffect(() => {
    if (route.params?.conditions !== undefined)
      setQuery({ ...EVERYONE, conditions: route.params.conditions });
    if (route.params?.search !== undefined) {
      setTyped(route.params.search);
      setSearch(route.params.search);
    }
    if (route.params?.view !== undefined) setShape(route.params.view);
  }, [route.params]);

  // My team: everybody whose manager is me, when People lets me filter by manager.
  const team: Query | null =
    myId === null
      ? null
      : { ...EVERYONE, conditions: [{ key: 'manager_id', op: 'is', values: [myId] }] };

  // HR's two numbers and who is starting, read beside the list.
  useEffect(() => {
    if (!hr) return;
    let live = true;
    void Promise.all([
      ask<Figures>(signed, 'Analytics', { segment: null }),
      ask<{
        people: {
          id: string;
          name: string;
          avatarUrl: string | null;
          values: { key: string; value: string }[];
          missing: number | null;
        }[];
      }>(signed, 'Directory', {
        conditions: [{ key: 'status', op: 'in', values: ['pre_hire'] }],
        sort: 'hire_date:asc',
      }),
    ]).then(([a, s]) => {
      if (!live) return;
      if (a.ok) setFigures({ headcount: a.data.headcount, complete: a.data.complete });
      if (s.ok)
        setStarters(
          s.data.people.slice(0, 6).map((p) => ({
            id: p.id,
            name: p.name,
            avatarUrl: p.avatarUrl,
            missing: p.missing,
            start:
              p.values.find((v) => v.key === 'hire_date' || v.key === 'start_date')?.value ?? null,
          })),
        );
    });
    return () => {
      live = false;
    };
  }, [hr, signed]);

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
      setUnread(
        t('people.people-tab.could_not_be_read', '“{{text}}” could not be read: {{message}}', {
          text,
          message: got.message,
        }),
      );
      return;
    }
    const plan = got.plan;
    if (plan.person !== null) {
      navigation.navigate('Profile', {
        personId: plan.person.id,
        name: plan.person.name,
        back: 'People',
      });
      return;
    }
    if (plan.by === 'search') {
      setQuestion(null);
      setQuery(EVERYONE);
      setSearch(plan.search ?? text);
      return;
    }
    setShape('list');
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
    setAnswerShown(true);
    setQuestion({
      sentence: text,
      unused: plan.unused,
      notes: [
        plan.note,
        ...plan.notes,
        plan.remembered === null
          ? null
          : t(
              'people.people-tab.read_as_as_you_chose_before',
              'Read “{{phrase}}” as {{toLowerCase}}, as you chose before.',
              { phrase: plan.remembered.phrase, toLowerCase: plan.remembered.label.toLowerCase() },
            ),
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

  const view = viewOf(query, team);
  const bare = view === 'everyone' && search === '' && question === null;
  const fields = page?.fields ?? [];
  const statuses = page?.fields?.some((f) => f.key === 'status') ?? true;
  const managerFilter = fields.some((f) => f.key === 'manager_id');
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
          : t(
              'people.people-tab.asked_for_their',
              'Asked {{peopleCount}} for their {{what}}.{{value}}',
              {
                peopleCount: peopleCount(done.asked),
                what,
                value: done.more ? ' That is the first 500; remind again for the rest.' : '',
              },
            );
      },
    );
  };
  const waiting = counts.status === 'ready' ? counts.data : {};

  const openPerson = (id: string, name?: string): void => {
    navigation.navigate('Profile', {
      personId: id,
      ...(name === undefined ? {} : { name }),
      back: 'People',
    });
  };

  const header = (
    <View className="gap-4">
      <SearchField
        ask
        value={typed}
        onValueChange={type}
        onSearch={(value) => void askIt(value)}
        placeholder={
          page === null || !bare
            ? t('people.people-tab.search_people_or_ask', 'Search people, or ask')
            : t('people.people-tab.search_people_or_ask_2', 'Search {{String}} people, or ask', {
                String: String(page.total),
              })
        }
        label={t(
          'people.people-tab.search_people_or_ask_a_question',
          'Search people, or ask a question',
        )}
      />
      {reading ? (
        <Loading label={t('people.people-tab.reading_the_question', 'Reading the question')} />
      ) : null}
      {unread === null ? null : (
        <Alert tone="danger" title={t('people.people-tab.not_understood', 'Not understood')}>
          {unread}
        </Alert>
      )}
      {question === null ? null : (
        <>
          <NeedsYou
            refused={question.refused}
            asked={question.ask}
            onPick={(r) => {
              if (question.ask?.topic != null) void rememberReading(question.ask.topic, r.label);
              setQuestion({ ...question, ask: null });
              setQuery({ ...query, conditions: r.conditions, match: r.match });
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
          <Conditions
            fields={fields}
            conditions={query.conditions}
            understood
            unused={question.unused}
            notes={question.notes}
            onRemove={(index) => {
              setQuery({ ...query, conditions: query.conditions.filter((_, i) => i !== index) });
            }}
            onDropUnused={(text) => {
              setQuestion({ ...question, unused: question.unused.filter((u) => u !== text) });
            }}
            onEdit={() => {
              setFiltering('builder');
            }}
            {...(query.conditions.length === 0
              ? {}
              : {
                  onSave: () => {
                    setSaving(true);
                  },
                })}
          />
          {page === null || !answerShown ? null : (
            // The answer (P4): the people and the next sensible step, before the list.
            <Card variant="assistant">
              <View className="flex-row items-center gap-2.5">
                <View className="size-[30px] items-center justify-center rounded-full bg-accent-solid">
                  <Icon icon={Sparkles} size={15} tone="on-accent" />
                </View>
                <Text variant="headline" className="flex-1">
                  {page.total === 0
                    ? t('people.people-tab.nobody_matches', 'Nobody matches')
                    : t('people.people-tab.match', '{{peopleCount}} match', {
                        peopleCount: peopleCount(page.total),
                      })}
                </Text>
              </View>
              {rows.slice(0, 3).map((p) => (
                <ListItem
                  key={p.id}
                  listitem={false}
                  className="bg-transparent px-0"
                  leading={
                    <PersonAvatar personId={p.id} name={p.name} avatarUrl={p.avatarUrl} size={40} />
                  }
                  description={lineOf(page, p)}
                  {...(p.missing === null || p.missing === 0
                    ? {}
                    : {
                        trailing: (
                          <Badge size="sm" tone="warning">
                            {t('people.people-tab.missing', '{{String}} missing', {
                              String: String(p.missing),
                            })}
                          </Badge>
                        ),
                      })}
                  onPress={() => {
                    openPerson(p.id, p.name);
                  }}
                >
                  {p.name}
                </ListItem>
              ))}
              <View className="flex-row flex-wrap gap-2 pt-1">
                {canRemind ? (
                  <Button
                    size="sm"
                    variant="tinted"
                    loading={busy === 'RemindDirectory'}
                    onPress={remindAll}
                  >
                    {page.total === 2
                      ? t('people.people-tab.remind_both', 'Remind both')
                      : t('people.people-tab.remind', 'Remind {{String}}', {
                          String: String(page.total),
                        })}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    setAnswerShown(false);
                  }}
                >
                  {t('people.people-tab.open_as_a_list', 'Open as a list')}
                </Button>
              </View>
            </Card>
          )}
        </>
      )}

      {bare && hr ? (
        <>
          <ReviewCard navigation={navigation} />
          {starters.length === 0 ? null : (
            <Card
              onPress={() => {
                setQuery(VIEWS['starting'] ?? EVERYONE);
              }}
              accessibilityLabel={t('people.people-tab.show_them', '{{startersTitle}}: show them', {
                startersTitle: startersTitle(starters),
              })}
            >
              <View className="flex-row items-center gap-3">
                <AvatarGroup size={36} max={2}>
                  {starters.map((s) => (
                    <PersonAvatar
                      key={s.id}
                      personId={s.id}
                      name={s.name}
                      avatarUrl={s.avatarUrl}
                      size={36}
                    />
                  ))}
                </AvatarGroup>
                <View className="flex-1 gap-0.5">
                  <Text variant="headline">{startersTitle(starters)}</Text>
                  <Text variant="subhead" tone="muted">
                    {startersLine(starters)}
                  </Text>
                </View>
              </View>
            </Card>
          )}
          {figures === null ? null : (
            <View className="flex-row gap-2.5">
              {figures.headcount === null ? null : (
                <Stat
                  className="flex-1"
                  label={t('people.people-tab.people', 'People')}
                  value={figures.headcount.value.toLocaleString(locale())}
                  size={26}
                  {...(figures.headcount.change === null || figures.headcount.change === 0
                    ? {}
                    : {
                        description: t(
                          'people.people-tab.since_last_month',
                          '{{value}}{{String}} since last month',
                          {
                            value: figures.headcount.change > 0 ? '+' : '',
                            String: String(figures.headcount.change),
                          },
                        ),
                      })}
                />
              )}
              {figures.complete === null ? null : (
                <Stat
                  className="flex-1"
                  label={t('people.people-tab.complete', 'Complete')}
                  value={String(figures.complete.percent)}
                  unit="%"
                  size={26}
                  description={t(
                    'people.people-tab.missing_details',
                    '{{replace}} missing details',
                    {
                      replace: peopleCount(figures.complete.incomplete).replace(
                        /people|person/u,
                        (w) => (w === 'person' ? 'record' : 'records'),
                      ),
                    },
                  )}
                />
              )}
            </View>
          )}
        </>
      ) : null}

      {question === null ? (
        <>
          <View className="flex-row items-center justify-between gap-3 px-1 pt-2">
            <Text variant="title3" weight="bold" accessibilityRole="header">
              {t('people.people-tab.everyone', 'Everyone')}
            </Text>
            <SegmentedControl
              value={shape}
              size="sm"
              accessibilityLabel={t('people.people-tab.show_people_as', 'Show people as')}
              onValueChange={(value) => {
                setShape(value === 'org' ? 'org' : 'list');
              }}
            >
              <SegmentedControlItem value="list">
                {t('people.people-tab.list', 'List')}
              </SegmentedControlItem>
              <SegmentedControlItem value="org">
                {t('people.people-tab.org_chart', 'Org chart')}
              </SegmentedControlItem>
            </SegmentedControl>
          </View>
          {shape === 'org' ? null : (
            <View className="flex-row items-center gap-2">
              <View className="flex-1">
                <ChipGroup
                  type="single"
                  value={view}
                  onValueChange={(value) => {
                    setQuestion(null);
                    setQuery(
                      value === 'team' && team !== null
                        ? team
                        : value.startsWith('segment:')
                          ? { ...EVERYONE, segment: value.slice('segment:'.length) }
                          : (VIEWS[value] ?? EVERYONE),
                    );
                  }}
                  accessibilityLabel={t('people.people-tab.views', 'Views')}
                  scroll
                >
                  <ChipGroupItem value="everyone">
                    {label('All', view === 'everyone' && search === '' ? page?.total : null)}
                  </ChipGroupItem>
                  {team !== null && managerFilter ? (
                    <ChipGroupItem value="team">
                      {t('people.people-tab.my_team', 'My team')}
                    </ChipGroupItem>
                  ) : null}
                  {statuses ? (
                    <ChipGroupItem value="starting">
                      {label(
                        t('people.people-tab.starting_soon', 'Starting soon'),
                        bare ? page?.notStarted : null,
                      )}
                    </ChipGroupItem>
                  ) : null}
                  {statuses ? (
                    <ChipGroupItem value="leaving">
                      {label('Leaving', bare ? page?.leaving : null)}
                    </ChipGroupItem>
                  ) : null}
                  {page?.incomplete === null ? null : (
                    <ChipGroupItem value="incomplete">
                      {label('Incomplete', bare ? page?.incomplete : null)}
                    </ChipGroupItem>
                  )}
                  {(page?.segments ?? []).map((segment) => (
                    <ChipGroupItem key={segment.id} value={`segment:${segment.id}`}>
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
                  accessibilityLabel={t(
                    'people.people-tab.choose_people_to_edit_together',
                    'Choose people to edit together',
                  )}
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
                  accessibilityLabel={t('people.people-tab.filter_people', 'Filter people')}
                  onPress={() => {
                    setFiltering('chips');
                  }}
                />
              )}
            </View>
          )}
          {view === '' && query.conditions.length > 0 ? (
            <Conditions
              fields={fields}
              conditions={query.conditions}
              understood={false}
              unused={[]}
              notes={[]}
              onRemove={(index) => {
                setQuery({ ...query, conditions: query.conditions.filter((_, i) => i !== index) });
              }}
              onDropUnused={() => undefined}
              onEdit={() => {
                setFiltering('chips');
              }}
              onSave={() => {
                setSaving(true);
              }}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button
          size="sm"
          startIcon={<Icon icon={Ellipsis} />}
          accessibilityLabel={t('people.people-tab.more', 'More')}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        label={t('people.people-tab.people', 'People')}
        align="end"
        className="w-[300px]"
      >
        <DropdownMenuItem
          icon={UserPlus}
          onSelect={() => {
            setAdding(true);
          }}
        >
          {t('people.people-tab.add_a_person', 'Add a person')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={Upload}
          onSelect={() => {
            setMoving('import');
          }}
        >
          {t('people.people-tab.import_from_a_spreadsheet', 'Import from a spreadsheet')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={Download}
          onSelect={() => {
            setMoving('export');
          }}
        >
          {t('people.people-tab.export', 'Export')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={ChartColumn}
          onSelect={() => {
            navigation.navigate('Insights');
          }}
        >
          {t('people.people-tab.insights_and_reports', 'Insights and reports')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={Copy}
          {...((waiting['duplicates'] ?? 0) > 0
            ? {
                description: t('people.people-tab.to_check', '{{String}} to check', {
                  String: String(waiting['duplicates']),
                }),
              }
            : {})}
          onSelect={() => {
            navigation.navigate('Review', { kind: 'duplicates' });
          }}
        >
          {t('people.people-tab.duplicate_records', 'Duplicate records')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={ShieldCheck}
          {...((waiting['accessRequests'] ?? 0) > 0
            ? {
                description: t(
                  'people.people-tab.requests',
                  { one: '{{count}} request', other: '{{count}} requests' },
                  { count: waiting['accessRequests'] },
                ),
              }
            : {})}
          onSelect={() => {
            navigation.navigate('Review', { kind: 'access' });
          }}
        >
          {t('people.people-tab.sensitive_data_access', 'Sensitive data access')}
        </DropdownMenuItem>
        {admin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={Settings}
              onSelect={() => {
                navigation.navigate('Settings');
              }}
            >
              {t('people.people-tab.people_settings', 'People settings')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const dialogs = (
    <>
      {moving === 'import' ? (
        <ImportDialog
          onClose={() => {
            setMoving(null);
          }}
          onStarted={(id) => {
            setMoving(null);
            navigation.navigate('ImportRun', { id });
          }}
          onFull={() => {
            setMoving(null);
            navigation.navigate('Import');
          }}
          onHistory={() => {
            setMoving(null);
            navigation.navigate('ImportExport');
          }}
        />
      ) : null}
      {moving === 'export' ? (
        <ExportDialog
          onClose={() => {
            setMoving(null);
          }}
          onDone={(id) => {
            setMoving(null);
            navigation.navigate('ExportRecord', { id });
          }}
          onFull={() => {
            setMoving(null);
            navigation.navigate('Export');
          }}
          onKept={(id, title) => {
            setMoving(null);
            navigation.navigate('DocumentDetail', { id, title });
          }}
        />
      ) : null}
      <AddPersonDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={(personId, name) => {
          openPerson(personId, name);
        }}
      />
      {filtering === 'builder' ? (
        <FiltersDialog
          fields={fields}
          conditions={query.conditions}
          match={query.match}
          onApply={(conditions, match) => {
            setQuery({ ...EVERYONE, conditions, match, sort: query.sort });
          }}
          onClose={() => {
            setFiltering(null);
          }}
        />
      ) : null}
      {filtering === 'chips' ? (
        <ChipFiltersDialog
          fields={fields}
          conditions={query.conditions}
          onApply={(conditions) => {
            setQuestion(null);
            setQuery({ ...EVERYONE, conditions, sort: query.sort });
          }}
          onMore={() => {
            setFiltering('builder');
          }}
          onClose={() => {
            setFiltering(null);
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
    </>
  );

  const trailing = hr ? (
    <View className="flex-row items-center gap-2">
      {menu}
      <Button
        size="sm"
        variant="primary"
        startIcon={<Icon icon={UserPlus} tone="on-accent" />}
        accessibilityLabel={t('people.people-tab.add_a_person', 'Add a person')}
        onPress={() => {
          setAdding(true);
        }}
      />
    </View>
  ) : undefined;

  const foot =
    picked !== null ? (
      <>
        <Button
          className="flex-1"
          onPress={() => {
            setPicked(null);
          }}
        >
          {t('people.people-tab.cancel', 'Cancel')}
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
          {t('people.people-tab.edit', 'Edit {{String}}', { String: String(picked.length) })}
        </Button>
      </>
    ) : undefined;

  if (shape === 'org' && question === null) {
    return (
      <Page large="People" {...(trailing === undefined ? {} : { trailing })}>
        {dialogs}
        {header}
        <OrgTree
          myId={myId}
          onOpen={(id, name) => {
            openPerson(id, name);
          }}
        />
      </Page>
    );
  }

  return (
    <Page
      large="People"
      scroll={false}
      {...(trailing === undefined ? {} : { trailing })}
      {...(foot === undefined ? {} : { foot })}
    >
      {dialogs}
      <View
        className="flex-1"
        onLayout={(event) => {
          setHeight(event.nativeEvent.layout.height);
        }}
      >
        {failed !== null ? (
          <Failed message={failed} onRetry={() => void first()} />
        ) : height === 0 ? null : (
          <VirtualList
            header={
              <>
                {header}
                {page === null ? (
                  <Loading label={t('people.people-tab.loading_people', 'Loading people')} />
                ) : null}
              </>
            }
            items={page === null ? [] : rows}
            label={t('people.people-tab.people', 'People')}
            height={height}
            itemKey={(person) => person.id}
            onEndReached={() => void next()}
            loadingMore={more}
            moreLoaded={(added) => `${String(added)} more people`}
            empty={
              page === null ? null : (
                <EmptyState
                  title={t('people.people-tab.nobody_matches', 'Nobody matches')}
                  description={t(
                    'people.people-tab.change_the_search_or_the_view',
                    'Change the search or the view to see more people.',
                  )}
                />
              )
            }
            renderItem={(person) => {
              const state = person.values.find((v) => v.key === 'status')?.value;
              const line = page === null ? '' : lineOf(page, person);
              return (
                <ListItem
                  listitem={false}
                  leading={
                    picked !== null ? (
                      <Checkbox
                        checked={picked.includes(person.id)}
                        accessibilityLabel={t('people.people-tab.choose', 'Choose {{name}}', {
                          name: person.name,
                        })}
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
                  {...(state === undefined || state === 'Active'
                    ? {}
                    : {
                        trailing: (
                          <Badge size="sm" dot tone={STATUS_TONE[state] ?? 'neutral'}>
                            {state}
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
                    openPerson(person.id, person.name);
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
