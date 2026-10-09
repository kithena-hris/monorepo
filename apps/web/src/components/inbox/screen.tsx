'use client';

import {
  Button,
  EmptyState,
  List,
  ListDetail,
  PageHeader,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TertiaryNav,
  ToastProvider,
  icons,
} from '@reach/ui';
import { TimeOffApprovalDetail } from '@kithena/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition, type JSX, type ReactNode } from 'react';

import {
  LANE_OF,
  filtered,
  groupsOf,
  moduleName,
  snoozedOf,
  type LaneName,
  type Shown,
} from '../../lib/inbox/model';
import type { InboxRead } from '../../lib/inbox/sources';
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
import { BulkDecideDialog, HandOverDialog, type Candidate } from './dialogs';
import { shortDay } from './format';
import { InboxRow } from './rows';

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
  readonly lane: LaneName;
  readonly item: string | null;
  readonly source: string | null;
  readonly q: string | null;
  readonly outcome: string | null;
  /** Whether they approve time off: Hand over is offered (G4). */
  readonly approves: boolean;
}

const LABEL: Readonly<Record<LaneName, string>> = {
  todo: 'To do',
  updates: 'Updates',
  requests: 'My requests',
  done: 'Done',
};

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

function Screen({ read, lane, item, source, q, outcome, approves }: InboxScreenProps): JSX.Element {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(item);
  const [search, setSearch] = useState(q ?? '');
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [readHere, setReadHere] = useState<ReadonlySet<string>>(new Set());
  const [showSnoozed, setShowSnoozed] = useState(false);
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

  // What was read here shows as read at once; the account catches up behind.
  const items = useMemo(
    () => read.items.map((i) => (readHere.has(i.id) ? { ...i, unread: false } : i)),
    [read.items, readHere],
  );
  const counts = {
    todo: read.counts.todo,
    updates: items.filter((i) => i.unread).length,
    requests: read.counts.requests,
  };
  const inLane = filtered(
    items.filter((i) => i.lane === LANE_OF[lane]),
    { source, q: search, outcome },
  );
  const groups = groupsOf(inLane, lane, now, zone);
  const snoozed = lane === 'todo' ? snoozedOf(inLane) : [];
  const ordered = [...groups.flatMap((g) => g.items), ...(showSnoozed ? snoozed : [])];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  // The address follows what is open and what the list shows, without a fetch.
  useEffect(() => {
    const next = `/inbox/${lane}${query({ item: selectedId, source, q: search, outcome })}`;
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [lane, selectedId, source, search, outcome]);

  const open = (i: Shown): void => {
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
  const filter = (k: 'source' | 'outcome', v: string): void => {
    router.replace(
      `/inbox/${lane}${query({ source: k === 'source' ? v : source, outcome: k === 'outcome' ? v : outcome, q: search })}`,
      { scroll: false },
    );
  };

  // Bulk: updates are read or tidied; time-off approvals decided together (G3).
  const picked = inLane.filter((i) => checked.has(i.id));
  const sameKind = picked.length > 0 && picked.every((i) => i.kind === 'timeoff.approval');
  const bulkWarning = (): string | null => {
    let worst: { out: number; of: number; team: string } | null = null;
    for (const p of picked) {
      const d = TimeOffApprovalDetail.safeParse(p.detail);
      if (!d.success || d.data.alreadyOut === null) continue;
      const out = d.data.alreadyOut.out + picked.length;
      if (worst === null || out > worst.out) {
        worst = { out, of: d.data.alreadyOut.of, team: d.data.teamName ?? 'the team' };
      }
    }
    return worst === null
      ? null
      : `Up to ${String(worst.out)} of ${String(worst.of)} people in ${worst.team} would be out at once.`;
  };

  const tabs = (
    <TertiaryNav
      label="Inbox"
      orientation="horizontal"
      variant="line"
      current="page"
      touchLayout="pills"
      activeId={lane}
      items={(['todo', 'updates', 'requests', 'done'] as const).map((l) => ({
        id: l,
        href: `/inbox/${l}`,
        label: LABEL[l],
        ...(l === 'done' ? {} : { count: counts[l] }),
      }))}
    />
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      <SearchField
        className="min-w-40 flex-1"
        label={lane === 'done' ? 'Search done' : 'Search'}
        value={search}
        onValueChange={setSearch}
        variant="field"
      />
      {read.modules.length > 1 ? (
        <Select
          value={source ?? 'all'}
          onValueChange={(v) => {
            filter('source', v === 'all' ? '' : v);
          }}
        >
          <SelectTrigger aria-label="Source" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {read.modules.map((m) => (
              <SelectItem key={m} value={m}>
                {moduleName(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {lane === 'done' ? (
        <Select
          value={outcome ?? 'all'}
          onValueChange={(v) => {
            filter('outcome', v === 'all' ? '' : v);
          }}
        >
          <SelectTrigger aria-label="Outcome" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
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
      {lane === 'updates' || lane === 'todo' ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSelecting((s) => !s);
            setChecked(new Set());
          }}
        >
          {selecting ? 'Done selecting' : 'Select'}
        </Button>
      ) : null}
      {lane === 'updates' && counts.updates > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Mark all read"
          startIcon={<icons.confirm aria-hidden />}
          onClick={() => {
            setReadHere(new Set(items.filter((i) => i.unread).map((i) => i.id)));
            start(async () => {
              await markAllRead();
            });
          }}
        />
      ) : null}
    </div>
  );

  const bulkBar =
    selecting && picked.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-subtle px-3 py-2">
        <span className="me-auto text-sm font-semibold">{`${String(picked.length)} selected`}</span>
        {lane === 'updates' ? (
          <>
            <Button
              size="sm"
              onClick={() => {
                setReadHere((was) => new Set([...was, ...picked.map((p) => p.id)]));
                start(async () => {
                  await markRead(picked.map((p) => p.id));
                });
                setChecked(new Set());
              }}
            >
              Mark read
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
              Move to Done
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
              {`Approve ${String(picked.length)}`}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDialog({ kind: 'bulk', decision: 'decline' });
              }}
            >
              Decline
            </Button>
          </>
        ) : (
          <span className="text-sm text-fg-muted">
            Only time-off approvals can be decided together
          </span>
        )}
      </div>
    ) : null;

  const empty: ReactNode =
    lane === 'todo' && search === '' && source === null ? (
      <EmptyState
        icon={<icons.success />}
        title="Nothing needs you"
        description={
          counts.updates > 0
            ? `New tasks appear here and on the red number. You have ${String(counts.updates)} unread update${counts.updates === 1 ? '' : 's'}.`
            : 'New tasks appear here and on the red number.'
        }
        {...(counts.updates > 0
          ? {
              action: (
                <Button asChild size="sm">
                  <a href="/inbox/updates">See updates</a>
                </Button>
              ),
            }
          : {})}
      />
    ) : (
      <EmptyState
        icon={<icons.inbox />}
        title={search === '' ? `Nothing in ${LABEL[lane]}` : 'Nothing matches'}
        description={
          lane === 'requests'
            ? 'What you ask for appears here until it is decided. Decided requests move to Done, and you get an update.'
            : lane === 'updates'
              ? 'News from every module you use lands here. Nothing is owed.'
              : lane === 'done'
                ? 'Finished tasks, decided requests and older updates stay here, for as long as your record does.'
                : 'Try another search or source.'
        }
      />
    );

  const row = (i: Shown): JSX.Element => (
    <InboxRow
      key={i.id}
      item={i}
      now={now}
      zone={zone}
      href={`/inbox/${lane}${query({ item: i.id, source, q: search, outcome })}`}
      selected={i.id === selectedId}
      selecting={selecting}
      checked={checked.has(i.id)}
      onCheck={(on) => {
        setChecked((was) => {
          const n = new Set(was);
          if (on) n.add(i.id);
          else n.delete(i.id);
          return n;
        });
      }}
      onOpen={() => {
        open(i);
      }}
      {...(i.lane === 'update'
        ? {
            swipe: [
              {
                label: i.unread ? 'Read' : 'Unread',
                tone: 'accent' as const,
                onSelect: () => {
                  if (i.unread) setReadHere((was) => new Set([...was, i.id]));
                  start(async () => {
                    await markRead([i.id], i.unread);
                  });
                },
              },
              {
                label: 'Done',
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

  const list = (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-surface shadow-sm">
      {toolbar}
      {bulkBar}
      {read.unanswered.length === 0 ? null : (
        <p className="border-b border-border px-4 py-2 text-sm text-fg-muted">
          {`${read.unanswered.map(moduleName).join(' and ')} did not answer just now; its items will be back.`}
        </p>
      )}
      <div className="flex-1 overflow-y-auto py-1">
        {groups.length === 0 && snoozed.length === 0 ? (
          <div className="p-6">{empty}</div>
        ) : (
          groups.map((g) => (
            <section key={g.label ?? 'all'} aria-label={g.label ?? LABEL[lane]}>
              {g.label === null ? null : (
                <h2 className="px-4.5 pt-3 pb-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                  {g.label}
                </h2>
              )}
              <List navigable>{g.items.map(row)}</List>
            </section>
          ))
        )}
        {snoozed.length === 0 ? null : (
          <div className="px-3 py-2">
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              startIcon={<icons.scheduled aria-hidden />}
              endIcon={showSnoozed ? <icons.collapse aria-hidden /> : <icons.expand aria-hidden />}
              aria-expanded={showSnoozed}
              onClick={() => {
                setShowSnoozed((s) => !s);
              }}
            >
              {`${String(snoozed.length)} snoozed${snoozed.length === 1 && snoozed[0]?.snoozedUntil != null ? ` until ${shortDay(snoozed[0].snoozedUntil.slice(0, 10))}` : ''}`}
            </Button>
            {showSnoozed ? <List navigable>{snoozed.map(row)}</List> : null}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col gap-4 touch:h-auto">
      <PageHeader
        title="Inbox"
        tabs={tabs}
        actions={
          <>
            {approves ? (
              <Button
                size="sm"
                startIcon={<icons.transfer aria-hidden />}
                onClick={() => {
                  start(async () => {
                    const d = await delegation();
                    if (d !== null) setDialog({ kind: 'handover', ...d });
                  });
                }}
              >
                Hand over
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm" startIcon={<icons.settings aria-hidden />}>
              <a href="/settings/notifications">Notifications</a>
            </Button>
          </>
        }
      />
      <Waking
        area={read.unanswered.join(' and ') || 'Inbox'}
        waking={read.waking && read.items.length === 0}
      >
        <ListDetail
          className="min-h-0 flex-1"
          listWidth="26rem"
          splitFrom="lg"
          listLabel={LABEL[lane]}
          detailLabel="Item"
          selected={selected !== null}
          onBack={() => {
            setSelectedId(null);
          }}
          backLabel={`Back to ${LABEL[lane]}`}
          list={list}
          detail={
            selected === null ? null : (
              <div className="h-full overflow-y-auto rounded-2xl bg-surface shadow-sm">
                <InboxDetail
                  key={selected.id}
                  item={selected}
                  now={now}
                  zone={zone}
                  onNext={next}
                />
              </div>
            )
          }
          emptyDetail={
            <div className="grid h-full place-items-center rounded-2xl bg-surface shadow-sm">
              <EmptyState
                icon={<icons.inbox />}
                title="Choose something from the list"
                description="It opens here."
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
      ) : null}
    </div>
  );
}
