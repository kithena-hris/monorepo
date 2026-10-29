'use client';

import {
  Avatar,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  ChangeDiff,
  Chip,
  ChipGroup,
  ChipGroupItem,
  DataTable,
  type DataColumn,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  PageHeader,
  SearchField,
  Stack,
  icons,
  usePages,
} from '@reach/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

import {
  AREAS,
  MODULES,
  MODULE_AREAS,
  WHO,
  changesIn,
  moduleName,
  type ActivityEntry,
  type ActivityFilters,
  type ActivityPage,
} from '../lib/activity';
import { noteInAddress, withQuery } from '../lib/url-state';
import { Waking } from './waking';
import { t } from '../lib/t';

/**
 * Settings › Activity (`docs/audit.md`): who did what, and when, across the
 * company, newest first. Every filter is the address's, so a filter is a
 * client-side navigation the server answers, Back undoes it, and a link opens
 * the same view.
 */

export type ActivityLoad =
  | { readonly status: 'ready'; readonly page: ActivityPage }
  | { readonly status: 'forbidden' }
  /**
   * The log could not be read for any other reason: the audit service not
   * deployed, not reachable, or not yet given the router's token. Said as
   * "not available yet", never as an error — the rest of the app does not
   * depend on it.
   */
  | { readonly status: 'unavailable' }
  /** The VM the log lives on is asleep or still waking (`components/waking.tsx`). */
  | { readonly status: 'waking' };

/** Names and faces People gave, by account id and by person id. */
export type Named = Readonly<
  Record<
    string,
    { readonly name: string; readonly avatarUrl: string | null; readonly personId: string }
  >
>;

const AREA_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  AREAS.map((a) => [a.value, a.label]),
);

/** The reader's zone once in their browser; UTC for the server's render and the first. */
function useZone(): string | undefined {
  const [zone, setZone] = useState<string | undefined>('UTC');
  useEffect(() => {
    setZone(undefined);
  }, []);
  return zone;
}

const someone = (): string =>
  t('components.activity-log.someone_at_your_company', 'Someone at your company');

/** Who did it, as the log names them: a person by name, support and the system by kind. */
function who(e: ActivityEntry, named: Named): { name: string; avatar: ReactNode } {
  switch (e.actorKind) {
    case 'support':
      return {
        // Which of Kithena's people, by the address their sign-in gave.
        name: e.operatorLabel === null ? 'Kithena support' : `Kithena support (${e.operatorLabel})`,
        avatar: <Avatar size="sm" name="Kithena support" fallback={<icons.help aria-hidden />} />,
      };
    case 'system':
      return {
        name: 'System',
        avatar: <Avatar size="sm" name="System" fallback={<icons.system aria-hidden />} />,
      };
    case 'integration':
      return {
        name: 'An integration',
        avatar: <Avatar size="sm" name="An integration" fallback={<icons.link aria-hidden />} />,
      };
    default: {
      const face = e.actorAccountId === null ? undefined : named[e.actorAccountId];
      const name = face?.name ?? someone();
      return {
        name,
        avatar: <Avatar size="sm" name={name} src={face?.avatarUrl ?? undefined} />,
      };
    }
  }
}

/**
 * Where a module's record opens, by what the entry says it was done to; a
 * kind not here has no page of its own to go to.
 */
const OPENS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  performance: {
    cycle: '/performance/cycles/',
    review: '/performance/reviews/',
    template: '/performance/templates/',
    goal: '/performance/goals/',
    learning: '/performance/learning/items/',
    automation: '/performance/automations/',
    calibration: '/performance/calibration/',
  },
  documents: { document: '/documents/' },
  recruiting: { job: '/recruiting/jobs/', candidate: '/recruiting/candidates/' },
  onboarding: { plan: '/onboarding/plans/' },
};

/** What it was done to, in words: a label, or the person's name as the reader may see it. */
function whom(e: ActivityEntry, named: Named): string | null {
  if (e.subjectLabel !== null) return e.subjectLabel;
  if ((e.subjectKind === 'person' || e.subjectKind === 'account') && e.subjectId !== null) {
    return named[e.subjectId]?.name ?? null;
  }
  return null;
}

/** An older page of the log, from `before`, with the names on it: the server's. */
export type MoreActivity = (
  before: string,
) => Promise<{ readonly load: ActivityLoad; readonly named: Named }>;

export function ActivityLog({
  load,
  named,
  filters,
  onMore,
}: {
  readonly load: ActivityLoad;
  readonly named: Named;
  readonly filters: ActivityFilters;
  readonly onMore?: MoreActivity | undefined;
}): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const zone = useZone();

  /** A filter changed: a new address, answered by the server, from the newest page. */
  const go = (
    patch: Readonly<Record<string, string | null>>,
    mode: 'push' | 'replace' = 'push',
  ) => {
    const to = withQuery(pathname, params.toString(), { entry: null, ...patch });
    if (mode === 'push') router.push(to, { scroll: false });
    else router.replace(to, { scroll: false });
  };

  // The search is in the address (`?q=`) once typing rests.
  const held = filters.search ?? '';
  const [query, setQuery] = useState(held);
  const sent = useRef(held);
  useEffect(() => {
    if (held === sent.current) return;
    sent.current = held;
    setQuery(held);
  }, [held]);
  useEffect(() => {
    if (query === sent.current) return undefined;
    const timer = setTimeout(() => {
      sent.current = query;
      go({ q: query.trim() === '' ? null : query.trim() }, 'replace');
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  const readerZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
  // One module's log keeps to the areas a module's activity falls in.
  const own =
    filters.module !== null && filters.module !== 'people' && filters.module !== 'identity';
  const areas = own ? AREAS.filter((a) => MODULE_AREAS.includes(a.value)) : AREAS;
  const title =
    filters.module === null
      ? t('components.activity-log.activity', 'Activity')
      : t('components.activity-log.activity_2', '{{moduleName}} activity', {
          moduleName: moduleName(filters.module),
        });
  const actorName =
    filters.actor === null
      ? null
      : (named[filters.actor]?.name ?? t('components.activity-log.one_person', 'one person'));
  const subjectName =
    filters.subject === null
      ? null
      : (named[filters.subject]?.name ?? t('components.activity-log.one_record', 'one record'));

  return (
    <Stack gap={6}>
      <PageHeader
        breadcrumb={
          <Breadcrumb className="touch:hidden">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/settings">
                  {t('components.activity-log.settings', 'Settings')}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              {filters.module === null ? (
                <BreadcrumbItem>
                  <BreadcrumbPage>
                    {t('components.activity-log.activity', 'Activity')}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              ) : (
                <>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="/settings/activity">
                      {t('components.activity-log.activity', 'Activity')}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{moduleName(filters.module)}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={title}
        description={
          filters.module === null
            ? t(
                'components.activity-log.who_did_what_and_when_across',
                'Who did what, and when, across your company’s workspace. Never the values themselves.',
              )
            : t(
                'components.activity-log.who_did_what_in_and_when',
                'Who did what in {{moduleName}}, and when. Never the values themselves.',
                { moduleName: moduleName(filters.module) },
              )
        }
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            size="sm"
            label={t('components.activity-log.search_the_activity', 'Search the activity')}
            placeholder={t(
              'components.activity-log.search_actions_names_and_reasons',
              'Search actions, names and reasons',
            )}
            value={query}
            onValueChange={setQuery}
            containerClassName="w-full max-w-[22rem]"
          />
          <DatePicker
            className="w-64 touch:w-full"
            mode="range"
            size="sm"
            label={t('components.activity-log.when', 'When')}
            placeholder={t('components.activity-log.any_time', 'Any time')}
            value={
              filters.from === null && filters.to === null
                ? null
                : { start: filters.from, end: filters.to }
            }
            onChange={(range) => {
              const on = range.start !== null || range.end !== null;
              go({ from: range.start, to: range.end, tz: on ? readerZone() : null });
            }}
          />
          <ChipGroup
            type="single"
            scroll
            aria-label={t('components.activity-log.who', 'Who')}
            value={filters.by ?? 'anyone'}
            onValueChange={(v) => {
              go({ by: v === '' || v === 'anyone' ? null : v });
            }}
            className="min-w-0 gap-1.5"
          >
            <ChipGroupItem value="anyone" variant="view">
              {t('components.activity-log.anyone', 'Anyone')}
            </ChipGroupItem>
            {WHO.map((w) => (
              <ChipGroupItem key={w.value} value={w.value} variant="view">
                {w.label}
              </ChipGroupItem>
            ))}
          </ChipGroup>
        </div>
        <ChipGroup
          type="single"
          scroll
          aria-label={t('components.activity-log.module', 'Module')}
          value={filters.module ?? 'any'}
          onValueChange={(v) => {
            // A module's areas are not another's: the area filter starts again.
            go({ module: v === '' || v === 'any' ? null : v, area: null });
          }}
          className="min-w-0 gap-1.5"
        >
          <ChipGroupItem value="any" variant="view">
            {t('components.activity-log.every_module', 'Every module')}
          </ChipGroupItem>
          {MODULES.map((m) => (
            <ChipGroupItem key={m.value} value={m.value} variant="view">
              {m.label}
            </ChipGroupItem>
          ))}
        </ChipGroup>
        <ChipGroup
          type="multiple"
          scroll
          aria-label={t('components.activity-log.areas', 'Areas')}
          value={[...filters.areas]}
          onValueChange={(v: string[]) => {
            go({ area: v.length === 0 ? null : v.join(',') });
          }}
          className="min-w-0 gap-1.5"
        >
          {areas.map((a) => (
            <ChipGroupItem key={a.value} value={a.value}>
              {a.label}
            </ChipGroupItem>
          ))}
        </ChipGroup>
        {actorName === null && subjectName === null ? null : (
          <div className="flex flex-wrap gap-2">
            {actorName === null ? null : (
              <Chip
                onRemove={() => {
                  go({ actor: null });
                }}
                removeLabel={t(
                  'components.activity-log.show_everybodys_not_only_s',
                  'Show everybody’s, not only {{actorName}}’s',
                  { actorName },
                )}
              >
                {t('components.activity-log.by', 'By')} {actorName}
              </Chip>
            )}
            {subjectName === null ? null : (
              <Chip
                onRemove={() => {
                  go({ subject: null });
                }}
                removeLabel={t(
                  'components.activity-log.show_every_record_not_only',
                  'Show every record, not only {{subjectName}}',
                  { subjectName },
                )}
              >
                {t('components.activity-log.about', 'About')} {subjectName}
              </Chip>
            )}
          </div>
        )}
      </div>
      <Waking
        area={t('components.activity-log.activity', 'Activity')}
        waking={load.status === 'waking'}
      >
        {load.status === 'waking' ? null : load.status === 'forbidden' ? (
          <EmptyState
            icon={<icons.locked />}
            title={t(
              'components.activity-log.the_activity_log_is_for_administrators',
              'The activity log is for administrators and HR',
            )}
            description={t(
              'components.activity-log.ask_one_of_your_people_administrators',
              'Ask one of your People administrators if you need to know who changed something.',
            )}
          />
        ) : load.status === 'unavailable' ? (
          <EmptyState
            icon={<icons.history />}
            title={t(
              'components.activity-log.the_activity_log_isnt_available_yet',
              'The activity log isn’t available yet',
            )}
            description={t(
              'components.activity-log.it_is_still_being_set_up',
              'It is still being set up for your workspace. Nothing is lost: what happens in the meantime is listed here once it is ready.',
            )}
          />
        ) : (
          <Entries
            page={load.page}
            named={named}
            zone={zone}
            open={params.get('entry')}
            onMore={onMore}
            filtered={Object.values({ ...filters, zone: null, module: null }).some(
              (v) => v !== null && !(Array.isArray(v) && v.length === 0),
            )}
            everyModule={filters.module === null}
            onFilter={go}
          />
        )}
      </Waking>
    </Stack>
  );
}

const show = (id: string | null): void => {
  noteInAddress({ entry: id }, id === null ? 'replace' : 'push');
};
const showEntry = (e: ActivityEntry): void => {
  show(e.id);
};
const entryId = (e: ActivityEntry): string => e.id;
const entryAction = (e: ActivityEntry): string => e.action;

function Entries({
  page,
  named: first,
  zone,
  open,
  onMore,
  filtered,
  everyModule,
  onFilter,
}: {
  readonly everyModule: boolean;
  readonly page: ActivityPage;
  readonly named: Named;
  readonly zone: string | undefined;
  /** The entry open in the panel (`?entry=`), when it is among those loaded. */
  readonly open: string | null;
  readonly onMore: MoreActivity | undefined;
  readonly filtered: boolean;
  readonly onFilter: (patch: Readonly<Record<string, string | null>>) => void;
}): JSX.Element {
  // Older pages as the reader scrolls, and the names each one brought.
  const [more, setMore] = useState<Named>({});
  const load = useCallback(
    async (before: string) => {
      if (onMore === undefined) return null;
      const answer = await onMore(before);
      if (answer.load.status !== 'ready') return null;
      setMore((n) => ({ ...n, ...answer.named }));
      return { items: answer.load.page.entries, next: answer.load.page.next };
    },
    [onMore],
  );
  const pages = usePages(page.entries, page.next, onMore === undefined ? undefined : load);
  const named = useMemo(() => ({ ...more, ...first }), [more, first]);
  const opened = open === null ? undefined : pages.items.find((e) => e.id === open);
  const when = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: zone,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso)),
    [zone],
  );
  // Held while the names and the zone hold, so opening an entry or a page
  // landing redraws only the rows that changed.
  const columns = useMemo<readonly DataColumn<ActivityEntry>[]>(
    () => [
      {
        id: 'when',
        header: t('components.activity-log.when', 'When'),
        width: '9.5rem',
        cell: (e) => (
          <time dateTime={e.occurredAt} title={e.occurredAt} className="tabular-nums">
            {when(e.occurredAt)}
          </time>
        ),
      },
      {
        id: 'who',
        header: t('components.activity-log.who', 'Who'),
        cell: (e) => {
          const actor = who(e, named);
          return (
            <span className="flex items-center gap-2.5">
              {actor.avatar}
              {actor.name}
            </span>
          );
        },
      },
      {
        id: 'what',
        header: t('components.activity-log.what', 'What'),
        cell: (e) => {
          const target = whom(e, named);
          return (
            <span className="flex flex-wrap items-center gap-2">
              <span>
                {e.action}
                {target === null ? null : (
                  <>
                    : <span className="font-semibold">{target}</span>
                  </>
                )}
              </span>
              {e.outcome === 'refused' ? (
                <Badge size="sm" tone="danger">
                  {t('components.activity-log.refused', 'Refused')}
                </Badge>
              ) : null}
              {e.ai ? (
                <Badge size="sm" tone="assistant">
                  {t('components.activity-log.ai', 'AI')}
                </Badge>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'area',
        header: t('components.activity-log.area', 'Area'),
        cardTrailing: true,
        cell: (e) => (
          <Badge>
            {everyModule && e.module !== 'people'
              ? t('components.activity-log.text', '{{moduleName}} · {{value}}', {
                  moduleName: moduleName(e.module),
                  value: AREA_NAME[e.area] ?? e.area,
                })
              : (AREA_NAME[e.area] ?? e.area)}
          </Badge>
        ),
      },
    ],
    [named, when, everyModule],
  );

  if (page.entries.length === 0) {
    return filtered ? (
      <EmptyState
        icon={<icons.filter />}
        title={t('components.activity-log.nothing_matches', 'Nothing matches')}
        description={t(
          'components.activity-log.nothing_recorded_matches_these_filters_remove',
          'Nothing recorded matches these filters. Remove one to see more.',
        )}
      />
    ) : (
      <EmptyState
        icon={<icons.history />}
        title={t('components.activity-log.nothing_recorded_yet', 'Nothing recorded yet')}
        description={t(
          'components.activity-log.settings_changes_imports_and_exports_sensitive',
          'Settings changes, imports and exports, sensitive access and Kithena support’s sign-ins are listed here as they happen.',
        )}
      />
    );
  }
  return (
    <>
      <DataTable<ActivityEntry>
        label={t('components.activity-log.activity', 'Activity')}
        rows={pages.items}
        rowId={entryId}
        // Infinite: the table is the page's one scroll, older entries load
        // near its end, and only the rows on screen are drawn.
        fill
        {...(pages.loadMore === undefined ? {} : { onEndReached: pages.loadMore })}
        loadingMore={pages.loading}
        {...(page.total == null ? {} : { total: page.total })}
        describeRow={entryAction}
        activeRowId={opened?.id ?? null}
        onRowClick={showEntry}
        columns={columns}
      />
      {/* One entry in full over the log, its place in the address. */}
      <Dialog
        open={opened !== undefined}
        onOpenChange={(o) => {
          if (!o) show(null);
        }}
      >
        {opened === undefined ? null : (
          <DialogContent sheetOnTouch>
            <DialogHeader>
              <DialogTitle>{opened.action}</DialogTitle>
              <DialogDescription>
                {t('components.activity-log.text_2', '{{name}} · {{occurredAt}}', {
                  name: who(opened, named).name,
                  occurredAt: when(opened.occurredAt),
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Detail entry={opened} named={named} when={when} onFilter={onFilter} />
            </DialogBody>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function Detail({
  entry: e,
  named,
  when,
  onFilter,
}: {
  readonly entry: ActivityEntry;
  readonly named: Named;
  readonly when: (iso: string) => string;
  readonly onFilter: (patch: Readonly<Record<string, string | null>>) => void;
}): JSX.Element {
  const changed = e.detail === null ? null : changesIn(e.detail);
  const actor = who(e, named).name;
  const record =
    e.subjectKind === 'person' && e.subjectId !== null
      ? (whom(e, named) ?? t('components.activity-log.this_person', 'this person'))
      : null;
  return (
    <Stack gap={3}>
      {changed === null ? (
        e.detail === null && (e.reason !== null || e.actorKind === 'support') ? null : (
          <p className="text-sm text-fg-muted">
            {e.detail ??
              t(
                'components.activity-log.no_more_detail_was_recorded',
                'No more detail was recorded.',
              )}
          </p>
        )
      ) : (
        <ChangeDiff
          items={changed.map((c) => ({ id: c.what, label: c.what, before: c.from, after: c.to }))}
        />
      )}
      {e.reason === null ? null : (
        <p className="text-sm">
          <span className="font-semibold">{t('components.activity-log.reason', 'Reason:')}</span>{' '}
          {e.reason}
        </p>
      )}
      {e.outcome === 'refused' ? (
        <p className="text-sm text-fg-muted">
          {moduleName(e.module)}{' '}
          {t(
            'components.activity-log.refused_it_nothing_was_changed',
            'refused it: nothing was changed.',
          )}
        </p>
      ) : null}
      {e.via === null && !e.ai ? null : (
        <p className="text-sm text-fg-muted">
          {[
            e.via === null
              ? null
              : t('components.activity-log.from', 'From {{value}}.', {
                  value:
                    e.via === 'Kithena'
                      ? t('components.activity-log.kithena_itself', 'Kithena itself')
                      : e.via,
                }),
            e.ai
              ? t(
                  'components.activity-log.proposed_by_ai_and_confirmed_by',
                  'Proposed by AI and confirmed by them.',
                )
              : null,
          ]
            .filter((x) => x !== null)
            .join(' ')}
        </p>
      )}
      {e.actorKind === 'support' ? (
        <p className="text-sm text-fg-muted">
          {e.area === 'sign_in'
            ? t(
                'components.activity-log.signed_in_from_the_kithena_back',
                'Signed in from the Kithena back office',
              )
            : e.supportSignIn === null
              ? t(
                  'components.activity-log.by_kithena_support_sign_in_not_in_log',
                  'By Kithena support; the sign-in it came from is not in the log',
                )
              : t(
                  'components.activity-log.during_kithena_supports_sign_in_at',
                  'During Kithena support’s sign-in at {{at}}{{value}}',
                  {
                    at: when(e.supportSignIn.at),
                    value:
                      e.supportSignIn.reason === null
                        ? ''
                        : t('components.activity-log.for_reason', ', for: {{reason}}', {
                            reason: e.supportSignIn.reason,
                          }),
                  },
                )}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {e.actorKind === 'person' && e.actorAccountId !== null ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onFilter({ actor: e.actorAccountId, by: null });
            }}
          >
            {t('components.activity-log.only_what_did', 'Only what {{actor}} did', { actor })}
          </Button>
        ) : null}
        {e.actorKind === 'person' ? null : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onFilter({ by: e.actorKind, actor: null });
            }}
          >
            {t('components.activity-log.only', 'Only')}{' '}
            {WHO.find((w) => w.value === e.actorKind)?.label ?? actor}
          </Button>
        )}
        {e.subjectId === null ||
        e.subjectKind === null ||
        OPENS[e.module]?.[e.subjectKind] === undefined ? null : (
          <Button size="sm" variant="ghost" asChild>
            <a href={`${OPENS[e.module]?.[e.subjectKind] ?? ''}${e.subjectId}`}>
              {t('components.activity-log.open', 'Open')}{' '}
              {e.subjectLabel ??
                t('components.activity-log.the', 'the {{subjectKind}}', {
                  subjectKind: e.subjectKind,
                })}
            </a>
          </Button>
        )}
        {record === null || e.subjectId === null ? null : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onFilter({ subject: e.subjectId });
              }}
            >
              {t('components.activity-log.only_s_record', 'Only {{record}}’s record', { record })}
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={`/people/${e.subjectId}`}>
                {t('components.activity-log.open', 'Open')} {record}
              </a>
            </Button>
          </>
        )}
      </div>
    </Stack>
  );
}
