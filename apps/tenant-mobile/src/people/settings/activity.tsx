import {
  Avatar,
  Button,
  Chip,
  ChipGroup,
  ChipGroupItem,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  List,
  ListItem,
  SearchField,
  Text,
} from '@reach/ui-native';
import { Filter, History, Lock } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Heading, Loading, Page } from '../../frame';
import { ask, useSigned } from '../api';
import type { PeopleScreen } from '../routes';
import { t } from '../../i18n';

const AREAS = () =>
  [
    { value: 'fields', label: t('people.settings.activity.employee_fields', 'Employee fields') },
    { value: 'organisation', label: t('people.settings.activity.organisation', 'Organisation') },
    { value: 'roles', label: t('people.settings.activity.roles', 'Roles') },
    { value: 'integrations', label: t('people.settings.activity.integrations', 'Integrations') },
    {
      value: 'imports_exports',
      label: t('people.settings.activity.imports_and_exports', 'Imports and exports'),
    },
    {
      value: 'sensitive_access',
      label: t('people.settings.activity.sensitive_access', 'Sensitive access'),
    },
    {
      value: 'sign_in',
      label: t('people.settings.activity.sign_in_and_support', 'Sign-in and support'),
    },
  ] as const;

const WHO = () =>
  [
    { value: 'person', label: t('people.settings.activity.people', 'People') },
    { value: 'support', label: t('people.settings.activity.kithena_support', 'Kithena support') },
    { value: 'system', label: t('people.settings.activity.system', 'System') },
    { value: 'integration', label: t('people.settings.activity.integrations', 'Integrations') },
  ] as const;

interface Entry {
  readonly id: string;
  readonly occurredAt: string;
  readonly area: string;
  readonly action: string;
  readonly detail: string | null;
  readonly actorKind: string;
  readonly actorAccountId: string | null;
  readonly operatorLabel: string | null;
  readonly subjectKind: string | null;
  readonly subjectId: string | null;
  readonly subjectLabel: string | null;
  readonly reason: string | null;
  readonly supportSignIn: { readonly at: string; readonly reason: string | null } | null;
}

interface Filters {
  readonly areas: readonly string[];
  readonly by: string | null;
  readonly actor: string | null;
  readonly subject: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly search: string | null;
}

type Named = Readonly<Record<string, { readonly name: string; readonly personId: string }>>;

const NONE: Filters = {
  areas: [],
  by: null,
  actor: null,
  subject: null,
  from: null,
  to: null,
  search: null,
};
const SOMEONE = 'Someone at your company';

const when = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

function who(e: Entry, named: Named): string {
  if (e.actorKind === 'support') {
    return e.operatorLabel === null
      ? t('people.settings.activity.kithena_support', 'Kithena support')
      : t('people.settings.activity.kithena_support_2', 'Kithena support ({{operatorLabel}})', {
          operatorLabel: e.operatorLabel,
        });
  }
  if (e.actorKind === 'system') return 'System';
  if (e.actorKind === 'integration')
    return t('people.settings.activity.an_integration', 'An integration');
  return (e.actorAccountId === null ? undefined : named[e.actorAccountId]?.name) ?? SOMEONE;
}

function whom(e: Entry, named: Named): string | null {
  if (e.subjectLabel !== null) return e.subjectLabel;
  if ((e.subjectKind === 'person' || e.subjectKind === 'account') && e.subjectId !== null) {
    return named[e.subjectId]?.name ?? null;
  }
  return null;
}

/** "Seen by: HR → HR and their manager." as its parts; null for a plain sentence. */
function changesIn(text: string): { what: string; from: string; to: string }[] | null {
  const found: { what: string; from: string; to: string }[] = [];
  for (const sentence of text.split(/\.(?=\s|$)/)) {
    const colon = sentence.indexOf(': ');
    if (colon === -1) continue;
    const arrow = sentence.indexOf(' → ', colon + 2);
    if (arrow === -1) continue;
    const what = sentence.slice(0, colon);
    if (/[.→]/.test(what)) continue;
    found.push({
      what: what.trim(),
      from: sentence.slice(colon + 2, arrow),
      to: sentence.slice(arrow + 3),
    });
  }
  return found.length === 0 ? null : found;
}

/**
 * The activity log (design H6): who did what, and when, newest first, never
 * the values. The search, the dates full width, who did it as pills, and the
 * areas; an entry opens in full with ways to narrow the log to it.
 */
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** "This week", then a month at a time, newest first. */
function groupsOf<T extends { occurredAt: string }>(items: readonly T[]): [string, T[]][] {
  const weekAgo = Date.now() - 7 * 86_400_000;
  const out = new Map<string, T[]>();
  for (const e of items) {
    const at = Date.parse(e.occurredAt);
    const key =
      at >= weekAgo
        ? t('people.settings.activity.this_week', 'This week')
        : MONTH.format(new Date(at));
    out.set(key, [...(out.get(key) ?? []), e]);
  }
  return [...out];
}

/** "Today", "Mon", "27 Sep". */
function shortWhen(iso: string): string {
  const at = new Date(iso);
  if (at.toDateString() === new Date().toDateString()) return 'Today';
  return Date.now() - at.getTime() < 7 * 86_400_000 ? WEEKDAY.format(at) : DAY.format(at);
}

export function Activity({ navigation, route }: PeopleScreen<'Activity'>): React.JSX.Element {
  const signed = useSigned();
  const [filters, setFilters] = useState<Filters>(() => ({
    ...NONE,
    areas: route.params?.areas ?? [],
  }));
  const [typed, setTyped] = useState('');
  const [moreFilters, setMoreFilters] = useState(false);
  const [entries, setEntries] = useState<readonly Entry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [named, setNamed] = useState<Named>({});
  const [status, setStatus] = useState<'ready' | 'forbidden' | 'unavailable'>('ready');
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<Entry | null>(null);
  const round = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => ({ ...f, search: typed.trim() === '' ? null : typed.trim() }));
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);

  const page = async (before: string | null): Promise<void> => {
    const mine = before === null ? ++round.current : round.current;
    const variables = Object.fromEntries(
      Object.entries({
        areas: filters.areas.length === 0 ? null : filters.areas,
        by: filters.by,
        actor: filters.actor,
        subject: filters.subject,
        from: filters.from,
        to: filters.to,
        zone:
          filters.from === null && filters.to === null
            ? null
            : Intl.DateTimeFormat().resolvedOptions().timeZone,
        search: filters.search,
        before,
      }).filter(([, v]) => v !== null),
    );
    const answer = await ask<{ entries: Entry[]; next: string | null }>(
      signed,
      'Activity',
      variables,
    );
    if (mine !== round.current) return;
    if (!answer.ok) {
      setStatus(answer.code === 'FORBIDDEN' ? 'forbidden' : 'unavailable');
      setEntries([]);
      return;
    }
    setStatus('ready');
    setEntries((held) => [...(before === null ? [] : (held ?? [])), ...answer.data.entries]);
    setNext(answer.data.next);
    // Names and faces, as People lets this reader see them; without, by kind alone.
    const accounts = new Set<string>();
    const people = new Set<string>();
    for (const e of answer.data.entries) {
      if (e.actorKind === 'person' && e.actorAccountId !== null) accounts.add(e.actorAccountId);
      if (e.subjectKind === 'account' && e.subjectId !== null) accounts.add(e.subjectId);
      if (e.subjectKind === 'person' && e.subjectId !== null) people.add(e.subjectId);
    }
    if (accounts.size + people.size === 0) return;
    const names = await ask<{
      people: { accountId: string | null; personId: string; name: string }[];
    }>(signed, 'Names', { accountIds: [...accounts], personIds: [...people] });
    if (!names.ok) return;
    setNamed((held) => {
      const out: Record<string, { name: string; personId: string }> = { ...held };
      for (const p of names.data.people) {
        out[p.personId] = { name: p.name, personId: p.personId };
        if (p.accountId !== null) out[p.accountId] = { name: p.name, personId: p.personId };
      }
      return out;
    });
  };
  useEffect(() => {
    setEntries(null);
    void page(null);
  }, [signed, filters]);

  const set = (patch: Partial<Filters>): void => {
    setOpen(null);
    setFilters((f) => ({ ...f, ...patch }));
  };
  const filtered = JSON.stringify({ ...filters }) !== JSON.stringify(NONE);
  const actorName = filters.actor === null ? null : (named[filters.actor]?.name ?? 'one person');
  const subjectName =
    filters.subject === null ? null : (named[filters.subject]?.name ?? 'one record');

  return (
    <Page
      title={t('people.settings.activity.activity_log', 'Activity log')}
      back={{
        label: t('people.settings.activity.settings', 'Settings'),
        onPress: navigation.goBack,
      }}
    >
      <View>
        <ChipGroup
          type="multiple"
          scroll
          accessibilityLabel={t('people.settings.activity.areas', 'Areas')}
          value={[...filters.areas]}
          onValueChange={(v: string[]) => {
            set({ areas: v });
          }}
        >
          {AREAS().map((a) => (
            <ChipGroupItem key={a.value} value={a.value}>
              {a.label}
            </ChipGroupItem>
          ))}
        </ChipGroup>
      </View>
      <SearchField
        value={typed}
        onValueChange={setTyped}
        placeholder={t(
          'people.settings.activity.search_actions_names_and_reasons',
          'Search actions, names and reasons',
        )}
        label={t('people.settings.activity.search_the_activity', 'Search the activity')}
      />
      <Button
        size="sm"
        variant="link"
        onPress={() => {
          setMoreFilters((m) => !m);
        }}
      >
        {moreFilters
          ? t('people.settings.activity.fewer_filters', 'Fewer filters')
          : t('people.settings.activity.who_and_when', 'Who and when')}
      </Button>
      {moreFilters ? (
        <>
          <DatePicker
            mode="range"
            size="sm"
            label={t('people.settings.activity.when', 'When')}
            placeholder={t('people.settings.activity.any_time', 'Any time')}
            value={
              filters.from === null && filters.to === null
                ? null
                : { start: filters.from, end: filters.to }
            }
            onChange={(range) => {
              set({ from: range.start, to: range.end });
            }}
          />
          <View>
            <ChipGroup
              type="single"
              scroll
              accessibilityLabel={t('people.settings.activity.who', 'Who')}
              value={filters.by ?? 'anyone'}
              onValueChange={(v) => {
                set({ by: v === '' || v === 'anyone' ? null : v });
              }}
            >
              <ChipGroupItem value="anyone" variant="view">
                {t('people.settings.activity.anyone', 'Anyone')}
              </ChipGroupItem>
              {WHO().map((w) => (
                <ChipGroupItem key={w.value} value={w.value} variant="view">
                  {w.label}
                </ChipGroupItem>
              ))}
            </ChipGroup>
          </View>
        </>
      ) : null}
      {actorName === null && subjectName === null ? null : (
        <View className="flex-row flex-wrap gap-2">
          {actorName === null ? null : (
            <Chip
              onRemove={() => {
                set({ actor: null });
              }}
              removeLabel={t(
                'people.settings.activity.show_everybodys_not_only_s',
                'Show everybody’s, not only {{actorName}}’s',
                { actorName },
              )}
            >
              {t('people.settings.activity.by', 'By {{actorName}}', { actorName })}
            </Chip>
          )}
          {subjectName === null ? null : (
            <Chip
              onRemove={() => {
                set({ subject: null });
              }}
              removeLabel={t(
                'people.settings.activity.show_every_record_not_only',
                'Show every record, not only {{subjectName}}',
                { subjectName },
              )}
            >
              {t('people.settings.activity.about', 'About {{subjectName}}', { subjectName })}
            </Chip>
          )}
        </View>
      )}
      {entries === null ? (
        <Loading
          label={t('people.settings.activity.loading_the_activity', 'Loading the activity')}
        />
      ) : status === 'forbidden' ? (
        <EmptyState
          icon={Lock}
          title={t(
            'people.settings.activity.the_activity_log_is_for_administrators',
            'The activity log is for administrators and HR',
          )}
          description={t(
            'people.settings.activity.ask_one_of_your_people_administrators',
            'Ask one of your People administrators if you need to know who changed something.',
          )}
        />
      ) : status === 'unavailable' ? (
        <EmptyState
          icon={History}
          title={t(
            'people.settings.activity.the_activity_log_isnt_available_yet',
            'The activity log isn’t available yet',
          )}
          description={t(
            'people.settings.activity.it_is_still_being_set_up',
            'It is still being set up for your workspace. What happens in the meantime is listed here once it is ready.',
          )}
        />
      ) : entries.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Filter}
            title={t('people.settings.activity.nothing_matches', 'Nothing matches')}
            description={t(
              'people.settings.activity.nothing_recorded_matches_these_filters_remove',
              'Nothing recorded matches these filters. Remove one to see more.',
            )}
          />
        ) : (
          <EmptyState
            icon={History}
            title={t('people.settings.activity.nothing_recorded_yet', 'Nothing recorded yet')}
            description={t(
              'people.settings.activity.settings_changes_imports_and_exports_sensitive',
              'Settings changes, imports and exports, sensitive access and Kithena support’s sign-ins are listed here as they happen.',
            )}
          />
        )
      ) : (
        <>
          {/* By week and month (v3 S10): who changed what, with when at the end of the line. */}
          {groupsOf(entries).map(([heading, items]) => (
            <View key={heading} className="gap-2">
              <Heading title={heading} />
              <List>
                {items.map((e) => {
                  const target = whom(e, named);
                  return (
                    <ListItem
                      key={e.id}
                      leading={<Avatar name={who(e, named)} size={36} />}
                      description={`${who(e, named)} · ${AREAS().find((x) => x.value === e.area)?.label ?? e.area}`}
                      meta={shortWhen(e.occurredAt)}
                      onPress={() => {
                        setOpen(e);
                      }}
                    >
                      {target === null ? e.action : `${e.action} · ${target}`}
                    </ListItem>
                  );
                })}
              </List>
            </View>
          ))}
          {next === null ? null : (
            <Button
              loading={more}
              onPress={() => {
                setMore(true);
                void page(next).then(() => {
                  setMore(false);
                });
              }}
            >
              {t('people.settings.activity.show_older', 'Show older')}
            </Button>
          )}
        </>
      )}
      {open === null ? null : (
        <EntryDialog
          entry={open}
          named={named}
          onClose={() => {
            setOpen(null);
          }}
          onFilter={set}
          onOpenRecord={(personId, name) => {
            setOpen(null);
            navigation.navigate('Profile', { personId, name, back: 'Activity' });
          }}
        />
      )}
    </Page>
  );
}

function EntryDialog({
  entry: e,
  named,
  onClose,
  onFilter,
  onOpenRecord,
}: {
  entry: Entry;
  named: Named;
  onClose: () => void;
  onFilter: (patch: Partial<Filters>) => void;
  onOpenRecord: (personId: string, name: string) => void;
}): React.JSX.Element {
  const changed = e.detail === null ? null : changesIn(e.detail);
  const actor = who(e, named);
  const record =
    e.subjectKind === 'person' && e.subjectId !== null ? (whom(e, named) ?? 'this person') : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{e.action}</DialogTitle>
          <DialogDescription>{`${actor} · ${when(e.occurredAt)}`}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {changed === null ? (
            e.detail === null && (e.reason !== null || e.actorKind === 'support') ? null : (
              <Text tone="muted">
                {e.detail ??
                  t(
                    'people.settings.activity.no_more_detail_was_recorded',
                    'No more detail was recorded.',
                  )}
              </Text>
            )
          ) : (
            <List>
              {changed.map((c) => (
                <ListItem key={c.what} description={`${c.from} → ${c.to}`}>
                  {c.what}
                </ListItem>
              ))}
            </List>
          )}
          {e.reason === null ? null : (
            <Text>
              {t('people.settings.activity.reason', 'Reason: {{reason}}', { reason: e.reason })}
            </Text>
          )}
          {e.actorKind === 'support' ? (
            <Text variant="footnote" tone="muted">
              {e.area === 'sign_in'
                ? t(
                    'people.settings.activity.signed_in_from_the_kithena_back',
                    'Signed in from the Kithena back office',
                  )
                : e.supportSignIn === null
                  ? 'By Kithena support; the sign-in it came from is not in the log'
                  : t(
                      'people.settings.activity.during_kithena_supports_sign_in_at',
                      'During Kithena support’s sign-in at {{when}}{{value}}',
                      {
                        when: when(e.supportSignIn.at),
                        value:
                          e.supportSignIn.reason === null ? '' : `, for: ${e.supportSignIn.reason}`,
                      },
                    )}
            </Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            {e.actorKind === 'person' && e.actorAccountId !== null ? (
              <Button
                size="sm"
                onPress={() => {
                  onFilter({ actor: e.actorAccountId, by: null });
                }}
              >
                {t('people.settings.activity.only_what_did', 'Only what {{actor}} did', { actor })}
              </Button>
            ) : e.actorKind === 'person' ? null : (
              <Button
                size="sm"
                onPress={() => {
                  onFilter({ by: e.actorKind, actor: null });
                }}
              >
                {t('people.settings.activity.only', 'Only {{value}}', {
                  value: WHO().find((w) => w.value === e.actorKind)?.label ?? actor,
                })}
              </Button>
            )}
            {record === null || e.subjectId === null ? null : (
              <>
                <Button
                  size="sm"
                  onPress={() => {
                    onFilter({ subject: e.subjectId });
                  }}
                >
                  {t('people.settings.activity.only_s_record', 'Only {{record}}’s record', {
                    record,
                  })}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    if (e.subjectId !== null) onOpenRecord(e.subjectId, record);
                  }}
                >
                  {t('people.settings.activity.open', 'Open {{record}}', { record })}
                </Button>
              </>
            )}
          </View>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.settings.activity.close', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
