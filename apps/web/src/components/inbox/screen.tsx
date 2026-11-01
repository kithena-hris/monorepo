'use client';

/*
 * THESIS: the Inbox is a triage desk. What is new is on top, then each item
 * where it belongs by what it needs from you, and every task is done where it
 * sits. It refuses the tabbed mailbox, where the same work hides behind lanes.
 * OWN-WORLD: Reach, restrained. Canvas neutrals; the accent only for what is
 * new, the chosen filter and the primary action. Rows are Reach list items,
 * sections are lean headings with their count, three of a kind stack.
 * STORY: open it, see what arrived since last time, act in the pane, then work
 * down Action required; Awaiting response and For information are a glance.
 * FIRST VIEWPORT: the header with what is new and what needs you; a search, a
 * filter menu (every view, with its count, and the module) and three chips
 * (All, Action required, Completed) over a 30rem list; the open item beside it.
 * FORM: one feed, newest first, then grouped (the brief's, over the roll's
 * board; seed 8c567a2a).
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md
 */

import {
  Button,
  EmptyState,
  formatList,
  icons,
  List,
  ListDetail,
  PageHeader,
  ScrollPositionRail,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  ChipGroup,
  ChipGroupItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ToastProvider,
} from '@reach/ui';
import { TimeOffApprovalDetail } from '@kithena/contracts';
import { useRouter } from 'next/navigation';
import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type JSX,
  type ReactNode,
} from 'react';

import {
  feedOf,
  filtered,
  groupsOf,
  moduleName,
  snoozedOf,
  type Entry,
  type SectionKey,
  type Shown,
  type View,
} from '../../lib/inbox/model';
import type { InboxRead } from '../../lib/inbox/sources';
import type { TaskScreen } from '../../lib/inbox/task-screen';
import {
  decideTimeOffMany,
  delegation,
  handOver,
  markAllRead,
  markRead,
  moveToDone,
} from '../../app/(app)/inbox/actions';
import { Waking } from '../waking';
import { InboxDetail } from './detail';
import { forgetGaps, prefetchGaps } from './detail-people';
import { forgetTaskScreens, prefetchTaskScreen } from './task-screen';
import { opensScreen } from '../../lib/inbox/opens-screen';
import { BulkDecideDialog, type Candidate } from './dialogs';
import { InboxRow } from './rows';
import { StackRow } from './stack';
import { t } from '../../lib/t';

// Picks a date or time: its own chunk, fetched when it opens (`dated-dialogs.tsx`).
const HandOverDialog = lazy(() =>
  import('./dated-dialogs').then((m) => ({ default: m.HandOverDialog })),
);

/**
 * The Inbox (INB-030 to INB-039): To do, Updates, My requests and Done, each
 * its own address, with the open item in it (`?item=`), so Back and a shared
 * link land on the same thing. The list on the left, the item on the right;
 * on a phone the item is pushed over the list.
 *
 * Moving between items is the browser's alone (the address is replaced, not
 * fetched): every item's detail came with the list. Acting runs the module's
 * write and the page is drawn again from the modules' answer.
 */

export interface InboxScreenProps {
  readonly read: InboxRead & { readonly zone: string };
  readonly view: View;
  readonly item: string | null;
  readonly source: string | null;
  readonly q: string | null;
  readonly outcome: string | null;
  /** Whether they approve time off: Hand over is offered (G4). */
  readonly approves: boolean;
  /** The open item's module screen, read with the page, when the pane draws one. */
  readonly screen?: TaskScreen | null;
}

/** The views a chip shows; the rest are in the filter menu, beside the module. */
const CHIPS = ['all', 'todo', 'done'] as const;
const LANE: Readonly<Record<'todo' | 'requests' | 'updates', Shown['lane']>> = {
  todo: 'task',
  requests: 'request',
  updates: 'update',
};

const VIEW_LABEL: Readonly<Record<View, () => string>> = {
  all: () => t('components.inbox.screen.view_all', 'All'),
  todo: () => t('components.inbox.screen.view_action_required', 'Action required'),
  requests: () => t('components.inbox.screen.view_awaiting_response', 'Awaiting response'),
  updates: () => t('components.inbox.screen.view_for_information', 'For information'),
  snoozed: () => t('components.inbox.screen.view_snoozed', 'Snoozed'),
  done: () => t('components.inbox.screen.view_completed', 'Completed'),
};

const SECTION_LABEL: Readonly<Record<SectionKey, () => string>> = {
  new: () => t('components.inbox.screen.section_new', 'New'),
  needs: () => t('components.inbox.screen.section_action_required', 'Action required'),
  waiting: () => t('components.inbox.screen.section_awaiting_response', 'Awaiting response'),
  fyi: () => t('components.inbox.screen.section_for_information', 'For information'),
};

const path = (view: View): string => (view === 'all' ? '/inbox' : `/inbox/${view}`);

const query = (params: Record<string, string | null>): string => {
  const search = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (v === null || v === '' ? [] : [[k, v]])),
  ).toString();
  return search === '' ? '' : `?${search}`;
};

export function InboxScreen(props: InboxScreenProps): JSX.Element {
  return (
    <ToastProvider>
      <Screen {...props} />
    </ToastProvider>
  );
}

function Screen({
  read,
  view,
  item,
  source,
  q,
  outcome,
  approves,
  screen,
}: InboxScreenProps): JSX.Element {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(item);
  const [search, setSearch] = useState(q ?? '');
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [readHere, setReadHere] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [sorted, setSorted] = useState(false);
  const [dialog, setDialog] = useState<
    | { readonly kind: 'bulk'; readonly decision: 'approve' | 'decline' }
    | {
        readonly kind: 'handover';
        readonly approverId: string;
        readonly candidates: readonly Candidate[];
        readonly current: { delegateName: string; from: string; to: string } | null;
      }
    | null
  >(null);
  const [, start] = useTransition();
  const { now, zone } = read;

  // What was opened here shows as seen at once; the account catches up behind.
  const items = useMemo(
    () => read.items.map((i) => (readHere.has(i.id) ? { ...i, unread: false } : i)),
    [read.items, readHere],
  );
  const fresh = items.filter((i) => i.unread);
  const snoozedCount = snoozedOf(items).length;
  // All is everything open: every other count is a part of it.
  const counts: Readonly<Record<View, number>> = {
    all: items.filter((i) => i.lane !== 'done' && !(i.lane === 'task' && i.snoozedUntil !== null))
      .length,
    todo: read.counts.todo,
    requests: read.counts.requests,
    updates: items.filter((i) => i.lane === 'update').length,
    snoozed: snoozedCount,
    done: items.filter((i) => i.lane === 'done').length,
  };
  const feed = view !== 'snoozed' && view !== 'done';
  // Where each sits is as it was when the page came: opening one here does not move it.
  // Mark all seen sorts them again, as asked.
  const shown = filtered(
    (sorted ? items : read.items).filter((i) =>
      view === 'done'
        ? i.lane === 'done'
        : view === 'snoozed'
          ? i.lane === 'task' && i.snoozedUntil !== null
          : view === 'all'
            ? true
            : i.lane === LANE[view],
    ),
    { source, q: search, outcome },
  );
  const sections = feed ? feedOf(shown) : [];
  const listBox = useRef<HTMLDivElement | null>(null);
  const doneGroups = view === 'done' ? groupsOf(shown, 'done', now, zone) : [];
  const snoozed = view === 'snoozed' ? shown : [];
  const ordered = feed
    ? sections.flatMap((s) =>
        s.entries.flatMap((e) =>
          e.kind === 'item' ? [e.item] : open.has(e.key) ? e.items : [e.items[0] as Shown],
        ),
      )
    : view === 'done'
      ? doneGroups.flatMap((g) => g.items)
      : snoozed;
  const selected = items.find((i) => i.id === selectedId) ?? null;

  /*
   * What an item opens to is fetched before it is opened: as a pointer rests
   * on its row, and the first few that need you while the browser is idle.
   * A write reads the Inbox again, and with it every kept screen.
   */
  const ahead = useMemo(() => {
    const byId = new Map(read.items.map((i) => [i.id, i]));
    return (id: string): void => {
      const i = byId.get(id);
      if (i === undefined) return;
      if (opensScreen(i)) void prefetchTaskScreen(i.link);
      else if (i.kind === 'people.setup') void prefetchGaps(i.id.replace(/^people:setup:/u, ''));
    };
  }, [read.items]);
  // Before the pane reads again (its effects run before this list's): a read
  // that is new forgets what was kept from the last.
  const keptFor = useRef(read);
  if (keptFor.current !== read) {
    keptFor.current = read;
    forgetTaskScreens();
    forgetGaps();
  }
  useEffect(() => {
    const first = ordered
      .filter((i) => i.lane === 'task')
      .slice(0, 3)
      .map((i) => i.id);
    const run = (): void => {
      for (const id of first) ahead(id);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(run, { timeout: 2000 });
      return () => {
        window.cancelIdleCallback(handle);
      };
    }
    const timer = setTimeout(run, 500);
    return () => {
      clearTimeout(timer);
    };
    // The first rows of this read; not again as the selection moves.
  }, [ahead]);

  // The address follows what is open and what the list shows, without a fetch.
  useEffect(() => {
    const next = `${path(view)}${query({ item: selectedId, source, q: search, outcome })}`;
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [view, selectedId, source, search, outcome]);

  const openItem = (i: Shown): void => {
    setSelectedId(i.id);
    if (i.unread) {
      setReadHere((was) => new Set([...was, i.id]));
      start(async () => {
        await markRead([i.id]);
      });
    }
  };
  const next = (): void => {
    const at = ordered.findIndex((i) => i.id === selectedId);
    const after =
      ordered.slice(at + 1).find((i) => i.id !== selectedId) ??
      ordered.find((i) => i.id !== selectedId);
    setSelectedId(after?.id ?? null);
  };
  const go = (to: View, keep: { source?: string | null; outcome?: string | null } = {}): void => {
    router.replace(
      `${path(to)}${query({
        source: keep.source === undefined ? source : keep.source,
        outcome: keep.outcome === undefined ? (to === 'done' ? outcome : null) : keep.outcome,
        q: search,
      })}`,
      { scroll: false },
    );
  };
  const markSeen = (ids: readonly string[]): void => {
    setReadHere((was) => new Set([...was, ...ids]));
    start(async () => {
      await markRead(ids);
    });
  };

  // Bulk: updates are read or tidied; time-off approvals decided together (G3).
  const picked = shown.filter((i) => checked.has(i.id));
  const allUpdates = picked.length > 0 && picked.every((i) => i.lane === 'update');
  const sameKind = picked.length > 0 && picked.every((i) => i.kind === 'timeoff.approval');
  const bulkWarning = (): string | null => {
    let worst: { out: number; of: number; team: string } | null = null;
    for (const p of picked) {
      const d = TimeOffApprovalDetail.safeParse(p.detail);
      if (!d.success || d.data.alreadyOut === null) continue;
      const out = d.data.alreadyOut.out + picked.length;
      if (worst === null || out > worst.out) {
        worst = {
          out,
          of: d.data.alreadyOut.of,
          team: d.data.teamName ?? t('components.inbox.screen.the_team', 'the team'),
        };
      }
    }
    return worst === null
      ? null
      : t(
          'components.inbox.screen.up_to_of_people_in_would',
          'Up to {{out}} of {{of}} people in {{team}} would be out at once.',
          { out: String(worst.out), of: String(worst.of), team: worst.team },
        );
  };

  const viewLabel = VIEW_LABEL[view]();

  const toolbar = (
    <div className="flex flex-col gap-2.5 border-b border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          className="min-w-40 flex-1"
          label={
            view === 'done'
              ? t('components.inbox.screen.search_done', 'Search done')
              : t('components.inbox.screen.search', 'Search')
          }
          value={search}
          onValueChange={setSearch}
          variant="field"
          placeholder={t('components.inbox.screen.search_your_inbox', 'Search your Inbox')}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={
                source === null && CHIPS.includes(view as (typeof CHIPS)[number])
                  ? 'secondary'
                  : 'primary'
              }
              startIcon={<icons.filter aria-hidden />}
              aria-label={t('components.inbox.screen.filter', 'Filter')}
            >
              {source === null ? undefined : moduleName(source)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('components.inbox.screen.show', 'Show')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={view}
              onValueChange={(v) => {
                go(v as View);
              }}
            >
              {(['all', 'todo', 'requests', 'updates', 'snoozed', 'done'] as const).map((v) => (
                <DropdownMenuRadioItem key={v} value={v}>
                  <span className="me-auto">{VIEW_LABEL[v]()}</span>
                  {counts[v] > 0 ? (
                    <span className="ms-4 text-fg-muted tabular-nums">{String(counts[v])}</span>
                  ) : null}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {read.modules.length > 1 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  {t('components.inbox.screen.module', 'Module')}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={source ?? 'all'}
                  onValueChange={(v) => {
                    go(view, { source: v === 'all' ? null : v });
                  }}
                >
                  <DropdownMenuRadioItem value="all">
                    {t('components.inbox.screen.every_module', 'Every module')}
                  </DropdownMenuRadioItem>
                  {read.modules.map((m) => (
                    <DropdownMenuRadioItem key={m} value={m}>
                      {moduleName(m)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {view === 'done' || view === 'snoozed' ? null : (
          <Button
            variant="ghost"
            // Under a finger a row is swiped, not ticked.
            className="touch:hidden"
            onClick={() => {
              setSelecting((s) => !s);
              setChecked(new Set());
            }}
          >
            {selecting
              ? t('components.inbox.screen.done_selecting', 'Done selecting')
              : t('components.inbox.screen.select', 'Select')}
          </Button>
        )}
      </div>
      <ChipGroup
        type="single"
        scroll
        aria-label={t('components.inbox.screen.show', 'Show')}
        value={view}
        onValueChange={(v) => {
          if (v !== '') go(v as View);
        }}
        className="min-w-0"
      >
        {[...CHIPS, ...(CHIPS.includes(view as (typeof CHIPS)[number]) ? [] : [view])].map((v) => (
          <ChipGroupItem key={v} value={v}>
            {v !== 'done' && counts[v] > 0
              ? `${VIEW_LABEL[v]()} · ${String(counts[v])}`
              : VIEW_LABEL[v]()}
          </ChipGroupItem>
        ))}
      </ChipGroup>
      {view === 'done' ? (
        <Select
          value={outcome ?? 'all'}
          onValueChange={(v) => {
            go('done', { outcome: v === 'all' ? null : v });
          }}
        >
          <SelectTrigger
            aria-label={t('components.inbox.screen.outcome', 'Outcome')}
            className="w-auto self-start"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t('components.inbox.screen.all_outcomes', 'All outcomes')}
            </SelectItem>
            {[
              ...new Set(
                items
                  .filter((i) => i.lane === 'done')
                  .flatMap((i) => (i.outcome === null ? [] : [i.outcome.label])),
              ),
            ].map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );

  const bulkBar =
    selecting && picked.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-subtle px-3 py-2">
        <span className="me-auto text-sm font-semibold">
          {t('components.inbox.screen.selected', '{{length}} selected', {
            length: String(picked.length),
          })}
        </span>
        {allUpdates ? (
          <>
            <Button
              size="sm"
              onClick={() => {
                markSeen(picked.map((p) => p.id));
                setChecked(new Set());
              }}
            >
              {t('components.inbox.screen.mark_read', 'Mark read')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              startIcon={<icons.archive aria-hidden />}
              onClick={() => {
                start(async () => {
                  await moveToDone(picked.map((p) => p.id));
                });
                setChecked(new Set());
                setSelecting(false);
              }}
            >
              {t('components.inbox.screen.move_to_done', 'Move to Done')}
            </Button>
          </>
        ) : sameKind ? (
          <>
            <Button
              size="sm"
              variant="primary"
              startIcon={<icons.approve aria-hidden />}
              onClick={() => {
                setDialog({ kind: 'bulk', decision: 'approve' });
              }}
            >
              {t('components.inbox.screen.approve', 'Approve {{length}}', {
                length: String(picked.length),
              })}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDialog({ kind: 'bulk', decision: 'decline' });
              }}
            >
              {t('components.inbox.screen.decline', 'Decline')}
            </Button>
          </>
        ) : (
          <span className="text-sm text-fg-muted">
            {t(
              'components.inbox.screen.updates_or_time_off_together',
              'Updates are read or tidied together, and time-off approvals decided together',
            )}
          </span>
        )}
      </div>
    ) : null;

  const filteredEmpty = search !== '' || source !== null;
  const empty: ReactNode = filteredEmpty ? (
    <EmptyState
      icon={<icons.search />}
      title={t('components.inbox.screen.nothing_matches', 'Nothing matches')}
      description={t(
        'components.inbox.screen.try_another_search_or_source',
        'Try another search or module.',
      )}
    />
  ) : view === 'done' ? (
    <EmptyState
      icon={<icons.archive />}
      title={t('components.inbox.screen.nothing_done_yet', 'Nothing done yet')}
      description={t(
        'components.inbox.screen.finished_tasks_decided_requests_and_older',
        'Finished tasks, decided requests and older updates stay here, for as long as your record does.',
      )}
    />
  ) : view === 'snoozed' ? (
    <EmptyState
      icon={<icons.scheduled />}
      title={t('components.inbox.screen.nothing_snoozed', 'Nothing snoozed')}
      description={t(
        'components.inbox.screen.snooze_puts_a_task_away',
        'Snooze puts a task away until the day you pick; it comes back as new.',
      )}
    />
  ) : (
    <EmptyState
      icon={<icons.success />}
      title={t('components.inbox.screen.all_caught_up', 'You are all caught up')}
      description={t(
        'components.inbox.screen.new_work_arrives_here',
        'New work arrives here first, and on your phone and desktop if you turn on push notifications.',
      )}
      action={
        <Button asChild size="sm">
          <a href="/settings/notifications">
            {t('components.inbox.screen.notification_settings', 'Notification settings')}
          </a>
        </Button>
      }
    />
  );

  const current = new Map(items.map((i) => [i.id, i]));
  const row = (placed: Shown, inNew = false): JSX.Element => {
    const i = current.get(placed.id) ?? placed;
    return (
      <InboxRow
        key={i.id}
        item={i}
        now={now}
        zone={zone}
        href={`${path(view)}${query({ item: i.id, source, q: search, outcome })}`}
        selected={i.id === selectedId}
        selecting={selecting}
        checked={checked.has(i.id)}
        fresh={inNew}
        onCheck={(on) => {
          setChecked((was) => {
            const n = new Set(was);
            if (on) n.add(i.id);
            else n.delete(i.id);
            return n;
          });
        }}
        onOpen={() => {
          openItem(i);
        }}
        {...(i.lane === 'update'
          ? {
              swipe: [
                {
                  label: i.unread
                    ? t('components.inbox.screen.read', 'Read')
                    : t('components.inbox.screen.unread', 'Unread'),
                  tone: 'accent' as const,
                  onSelect: () => {
                    if (i.unread) setReadHere((was) => new Set([...was, i.id]));
                    start(async () => {
                      await markRead([i.id], i.unread);
                    });
                  },
                },
                {
                  label: t('components.inbox.screen.done', 'Done'),
                  onSelect: () => {
                    start(async () => {
                      await moveToDone([i.id]);
                    });
                  },
                },
              ],
            }
          : {})}
      />
    );
  };

  const entry = (e: Entry, inNew: boolean): JSX.Element | JSX.Element[] =>
    e.kind === 'item' ? (
      row(e.item, inNew)
    ) : (
      <StackRow
        key={e.key}
        items={e.items}
        open={open.has(e.key)}
        onToggle={() => {
          setOpen((was) => {
            const n = new Set(was);
            if (n.has(e.key)) n.delete(e.key);
            else n.add(e.key);
            return n;
          });
        }}
      >
        {e.items.map((i) => row(i))}
      </StackRow>
    );

  const heading = (key: SectionKey, count: number): JSX.Element => (
    // Not sticky: the list's toolbar already pins under the page's header, and
    // a third layer pinned under both slid over them as the window scrolled.
    <div className="flex items-center gap-2 px-4.5 pt-4 pb-1.5">
      <h2 className="text-sm font-semibold text-fg">{SECTION_LABEL[key]()}</h2>
      <Badge
        size="sm"
        tone={key === 'new' ? 'accent' : 'neutral'}
        variant={key === 'new' ? 'solid' : 'soft'}
      >
        {String(count)}
      </Badge>
      <span className="flex-1" />
      {key === 'new' ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setReadHere((was) => new Set([...was, ...fresh.map((i) => i.id)]));
            setSorted(true);
            start(async () => {
              await markRead(fresh.map((i) => i.id));
              await markAllRead();
            });
          }}
        >
          {t('components.inbox.screen.mark_all_seen', 'Mark all seen')}
        </Button>
      ) : null}
    </div>
  );

  const body: ReactNode = feed ? (
    sections.length === 0 ? (
      <div className="p-6">{empty}</div>
    ) : (
      sections.map((s) => (
        <section key={s.key} aria-label={SECTION_LABEL[s.key]()}>
          {heading(
            s.key,
            s.entries.reduce((n, e) => n + (e.kind === 'item' ? 1 : e.items.length), 0),
          )}
          <List navigable>{s.entries.flatMap((e) => entry(e, s.key === 'new'))}</List>
        </section>
      ))
    )
  ) : view === 'done' ? (
    doneGroups.length === 0 ? (
      <div className="p-6">{empty}</div>
    ) : (
      doneGroups.map((g) => (
        <section key={g.label ?? 'all'} aria-label={g.label ?? viewLabel}>
          {g.label === null ? null : (
            <h2 className="px-4.5 pt-4 pb-1.5 text-sm font-semibold text-fg">{g.label}</h2>
          )}
          <List navigable>{g.items.map((i) => row(i))}</List>
        </section>
      ))
    )
  ) : snoozed.length === 0 ? (
    <div className="p-6">{empty}</div>
  ) : (
    <List navigable>{snoozed.map((i) => row(i))}</List>
  );

  const list = (
    // `clip`, not `hidden`: rounded without becoming a scroll box, so the
    // window scrolls the list and its toolbar sticks under the page's header.
    <div ref={listBox} className="flex flex-col overflow-clip rounded-2xl bg-surface shadow-sm">
      <div data-list-head className="sticky top-(--reach-sticky-top,0px) z-10 bg-surface">
        {toolbar}
        {bulkBar}
      </div>
      {read.unanswered.length === 0 ? null : (
        <p className="border-b border-border px-4 py-2 text-sm text-fg-muted">
          {t(
            'components.inbox.screen.modules_did_not_answer',
            {
              one: '{{modules}} did not answer just now; its items will be back.',
              other: '{{modules}} did not answer just now; their items will be back.',
            },
            { count: read.unanswered.length, modules: formatList(read.unanswered.map(moduleName)) },
          )}
        </p>
      )}
      <div
        className="pb-2"
        onPointerOver={(event) => {
          const href = (event.target as HTMLElement).closest('a')?.getAttribute('href');
          const id = href == null ? null : new URL(href, 'http://inbox').searchParams.get('item');
          if (id !== null) ahead(id);
        }}
        onKeyDown={(event) => {
          // D5: X selects the row in focus, as in Review.
          if (event.key !== 'x' || event.metaKey || event.ctrlKey || event.altKey || !feed) return;
          const href = (event.target as HTMLElement).closest('a')?.getAttribute('href') ?? '';
          const id = new URL(href, 'http://inbox').searchParams.get('item');
          if (id === null) return;
          event.preventDefault();
          setSelecting(true);
          setChecked((was) => {
            const n = new Set(was);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          });
        }}
      >
        {body}
      </div>
      {/* How many, where the reader is among them, and back to the top. */}
      <ScrollPositionRail
        list={listBox}
        loaded={shown.length}
        total={shown.length}
        className="pb-3"
      />
    </div>
  );

  const summary =
    fresh.length === 0 && counts.todo === 0
      ? t('components.inbox.screen.nothing_new', 'Nothing new, nothing waiting on you')
      : [
          fresh.length === 0
            ? null
            : t(
                'components.inbox.screen.count_new',
                { one: '{{count}} new', other: '{{count}} new' },
                { count: fresh.length },
              ),
          counts.todo === 0
            ? null
            : t(
                'components.inbox.screen.count_need_you',
                { one: '{{count}} needs you', other: '{{count}} need you' },
                { count: counts.todo },
              ),
        ]
          .filter((x) => x !== null)
          .join(' · ');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('components.inbox.screen.inbox', 'Inbox')}
        description={summary}
        actions={
          <>
            {approves ? (
              <Button
                startIcon={<icons.transfer aria-hidden />}
                onClick={() => {
                  start(async () => {
                    const d = await delegation();
                    if (d !== null) setDialog({ kind: 'handover', ...d });
                  });
                }}
              >
                {t('components.inbox.screen.hand_over', 'Hand over')}
              </Button>
            ) : null}
            <Button asChild variant="ghost" startIcon={<icons.settings aria-hidden />}>
              <a href="/settings/notifications">
                {t('components.inbox.screen.notifications', 'Notifications')}
              </a>
            </Button>
          </>
        }
      />
      <Waking
        area={
          formatList(read.unanswered.map(moduleName)) || t('components.inbox.screen.inbox', 'Inbox')
        }
        waking={read.waking && read.items.length === 0}
      >
        <ListDetail
          listWidth="30rem"
          splitFrom="lg"
          listLabel={viewLabel}
          detailLabel={t('components.inbox.screen.item', 'Item')}
          selected={selected !== null}
          onBack={() => {
            setSelectedId(null);
          }}
          backLabel={t('components.inbox.screen.back_to', 'Back to {{LABEL}}', {
            LABEL: viewLabel,
          })}
          list={list}
          detail={
            selected === null ? null : (
              <div className="rounded-2xl bg-surface shadow-sm">
                <InboxDetail
                  key={selected.id}
                  item={selected}
                  now={now}
                  zone={zone}
                  onNext={next}
                  {...(selected.id === item && screen !== undefined ? { screen } : {})}
                />
              </div>
            )
          }
          emptyDetail={
            <div className="grid min-h-[min(32rem,60dvh)] place-items-center rounded-2xl bg-surface shadow-sm">
              <EmptyState
                icon={<icons.inbox />}
                title={
                  fresh.length > 0
                    ? t('components.inbox.screen.start_with_whats_new', 'Start with what is new')
                    : t(
                        'components.inbox.screen.choose_something_from_the_list',
                        'Choose something from the list',
                      )
                }
                description={t(
                  'components.inbox.screen.it_opens_here_to_act_on',
                  'It opens here, and what it asks of you is done here too.',
                )}
              />
            </div>
          }
        />
      </Waking>
      {dialog?.kind === 'bulk' ? (
        <BulkDecideDialog
          items={picked}
          decision={dialog.decision}
          warning={dialog.decision === 'approve' ? bulkWarning() : null}
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={(note) => {
            const ids = picked.flatMap((p) => {
              const d = TimeOffApprovalDetail.safeParse(p.detail);
              return d.success ? [d.data.requestId] : [];
            });
            setDialog(null);
            setChecked(new Set());
            setSelecting(false);
            start(async () => {
              await decideTimeOffMany(ids, dialog.decision, note);
              router.refresh();
            });
          }}
        />
      ) : null}
      {dialog?.kind === 'handover' ? (
        <Suspense fallback={null}>
          <HandOverDialog
            candidates={dialog.candidates}
            current={dialog.current}
            onClose={() => {
              setDialog(null);
            }}
            onStop={() => {
              const approverId = dialog.approverId;
              setDialog(null);
              start(async () => {
                await handOver(approverId, null);
              });
            }}
            onSave={(input) => {
              const approverId = dialog.approverId;
              setDialog(null);
              start(async () => {
                await handOver(approverId, input);
              });
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
