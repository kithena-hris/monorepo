'use client';

import {
  Alert,
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
  DatePicker,
  EmptyState,
  PageHeader,
  SearchField,
  Stack,
  icons,
} from '@reach/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import {
  AREAS,
  WHO,
  changesIn,
  type ActivityEntry,
  type ActivityFilters,
  type ActivityPage,
} from '../lib/activity';
import { withQuery } from '../lib/url-state';

/**
 * Settings › Activity (`docs/audit.md`): who did what, and when, across the
 * company, newest first. Every filter is the address's, so a filter is a
 * client-side navigation the server answers, Back undoes it, and a link opens
 * the same view.
 */

export type ActivityLoad =
  | { readonly status: 'ready'; readonly page: ActivityPage }
  | { readonly status: 'forbidden'; readonly message: string }
  | { readonly status: 'error'; readonly message: string };

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

const SOMEONE = 'Someone at your company';

/** Who did it, as the log names them: a person by name, support and the system by kind. */
function who(e: ActivityEntry, named: Named): { name: string; avatar: ReactNode } {
  switch (e.actorKind) {
    case 'support':
      return {
        name: 'Kithena support',
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
      const name = face?.name ?? SOMEONE;
      return {
        name,
        avatar: <Avatar size="sm" name={name} src={face?.avatarUrl ?? undefined} />,
      };
    }
  }
}

/** What it was done to, in words: a label, or the person's name as the reader may see it. */
function whom(e: ActivityEntry, named: Named): string | null {
  if (e.subjectLabel !== null) return e.subjectLabel;
  if ((e.subjectKind === 'person' || e.subjectKind === 'account') && e.subjectId !== null) {
    return named[e.subjectId]?.name ?? null;
  }
  return null;
}

export function ActivityLog({
  load,
  named,
  filters,
}: {
  readonly load: ActivityLoad;
  readonly named: Named;
  readonly filters: ActivityFilters;
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
    const to = withQuery(pathname, params.toString(), { before: null, ...patch });
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
  const actorName = filters.actor === null ? null : (named[filters.actor]?.name ?? 'one person');
  const subjectName =
    filters.subject === null ? null : (named[filters.subject]?.name ?? 'one record');

  return (
    <Stack gap={6}>
      <PageHeader
        breadcrumb={
          <Breadcrumb className="touch:hidden">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/settings">Settings</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Activity</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="Activity"
        description="Who did what, and when, across your company’s workspace. Never the values themselves."
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            size="sm"
            label="Search the activity"
            placeholder="Search actions, names and reasons"
            value={query}
            onValueChange={setQuery}
            containerClassName="w-full max-w-[22rem]"
          />
          <DatePicker
            className="w-64 touch:w-full"
            mode="range"
            size="sm"
            label="When"
            placeholder="Any time"
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
            aria-label="Who"
            value={filters.by ?? 'anyone'}
            onValueChange={(v) => {
              go({ by: v === '' || v === 'anyone' ? null : v });
            }}
            className="min-w-0 gap-1.5"
          >
            <ChipGroupItem value="anyone" variant="view">
              Anyone
            </ChipGroupItem>
            {WHO.map((w) => (
              <ChipGroupItem key={w.value} value={w.value} variant="view">
                {w.label}
              </ChipGroupItem>
            ))}
          </ChipGroup>
        </div>
        <ChipGroup
          type="multiple"
          scroll
          aria-label="Areas"
          value={[...filters.areas]}
          onValueChange={(v: string[]) => {
            go({ area: v.length === 0 ? null : v.join(',') });
          }}
          className="min-w-0 gap-1.5"
        >
          {AREAS.map((a) => (
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
                removeLabel={`Show everybody’s, not only ${actorName}’s`}
              >
                By {actorName}
              </Chip>
            )}
            {subjectName === null ? null : (
              <Chip
                onRemove={() => {
                  go({ subject: null });
                }}
                removeLabel={`Show every record, not only ${subjectName}`}
              >
                About {subjectName}
              </Chip>
            )}
          </div>
        )}
      </div>
      {load.status === 'forbidden' ? (
        <EmptyState
          icon={<icons.locked />}
          title="The activity log is for administrators and HR"
          description="Ask one of your People administrators if you need to know who changed something."
        />
      ) : load.status === 'error' ? (
        <Alert tone="danger" title="The activity log could not be read">
          {load.message}
        </Alert>
      ) : (
        <Entries
          page={load.page}
          named={named}
          zone={zone}
          paged={filters.before !== null}
          filtered={Object.values({ ...filters, zone: null }).some(
            (v) => v !== null && !(Array.isArray(v) && v.length === 0),
          )}
          onFilter={go}
        />
      )}
    </Stack>
  );
}

function Entries({
  page,
  named,
  zone,
  paged,
  filtered,
  onFilter,
}: {
  readonly page: ActivityPage;
  readonly named: Named;
  readonly zone: string | undefined;
  readonly paged: boolean;
  readonly filtered: boolean;
  readonly onFilter: (patch: Readonly<Record<string, string | null>>) => void;
}): JSX.Element {
  if (page.entries.length === 0) {
    return filtered ? (
      <EmptyState
        icon={<icons.filter />}
        title="Nothing matches"
        description="Nothing recorded matches these filters. Remove one to see more."
      />
    ) : (
      <EmptyState
        icon={<icons.history />}
        title="Nothing recorded yet"
        description="Settings changes, imports and exports, sensitive access and Kithena support’s sign-ins are listed here as they happen."
      />
    );
  }
  const when = (iso: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  return (
    <Stack gap={4}>
      <DataTable<ActivityEntry>
        label="Activity"
        rows={page.entries}
        rowId={(e) => e.id}
        columns={[
          {
            id: 'when',
            header: 'When',
            width: '9.5rem',
            cell: (e) => (
              <time dateTime={e.occurredAt} title={e.occurredAt} className="tabular-nums">
                {when(e.occurredAt)}
              </time>
            ),
          },
          {
            id: 'who',
            header: 'Who',
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
            header: 'What',
            cell: (e) => {
              const target = whom(e, named);
              return target === null ? (
                e.action
              ) : (
                <>
                  {e.action}: <span className="font-semibold">{target}</span>
                </>
              );
            },
          },
          {
            id: 'area',
            header: 'Area',
            cardTrailing: true,
            cell: (e) => <Badge>{AREA_NAME[e.area] ?? e.area}</Badge>,
          },
        ]}
        renderDetail={(e) => <Detail entry={e} named={named} when={when} onFilter={onFilter} />}
      />
      {!paged && page.next === null ? null : (
        <nav aria-label="Older activity" className="flex gap-2">
          {paged ? (
            <Button
              onClick={() => {
                onFilter({ before: null });
              }}
            >
              Newest
            </Button>
          ) : null}
          {page.next === null ? null : (
            <Button
              onClick={() => {
                onFilter({ before: page.next });
              }}
            >
              Older
            </Button>
          )}
        </nav>
      )}
    </Stack>
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
    e.subjectKind === 'person' && e.subjectId !== null ? (whom(e, named) ?? 'this person') : null;
  return (
    <Stack gap={3}>
      {changed === null ? (
        e.detail === null && (e.reason !== null || e.actorKind === 'support') ? null : (
          <p className="text-sm text-fg-muted">{e.detail ?? 'No more detail was recorded.'}</p>
        )
      ) : (
        <ChangeDiff
          items={changed.map((c) => ({ id: c.what, label: c.what, before: c.from, after: c.to }))}
        />
      )}
      {e.reason === null ? null : (
        <p className="text-sm">
          <span className="font-semibold">Reason:</span> {e.reason}
        </p>
      )}
      {e.actorKind === 'support' ? (
        <p className="text-sm text-fg-muted">
          {e.area === 'sign_in'
            ? 'Signed in from the Kithena back office'
            : e.supportSignIn === null
              ? 'By Kithena support; the sign-in it came from is not in the log'
              : `During Kithena support’s sign-in at ${when(e.supportSignIn.at)}${
                  e.supportSignIn.reason === null ? '' : `, for: ${e.supportSignIn.reason}`
                }`}
          {e.onBehalfOf === null ? '' : ` · operator ${e.onBehalfOf.slice(0, 8)}`}
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
            Only what {actor} did
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
            Only {actor === 'An integration' ? 'integrations' : actor}
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
              Only {record}’s record
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={`/people/${e.subjectId}`}>Open {record}</a>
            </Button>
          </>
        )}
      </div>
    </Stack>
  );
}
