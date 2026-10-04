import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ChipGroup,
  ChipGroupItem,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  KeyValues,
  List,
  ListDetail,
  ListItem,
  PageHeader,
  PageSection,
  PINNED_BAR,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  icons,
  type RowAction,
} from '@reach/ui';
import { useState, type ComponentProps, type JSX, type ReactNode } from 'react';

import {
  ChangeDetail,
  Checks,
  ago,
  asField,
  isClosed,
  isFlagged,
  summaryOf,
  type ApprovalItem,
  type ApprovalsState,
  type ChangeActions,
} from '../approvals/approvals';
import {
  MissingDetails,
  type CompletenessState,
  type MissingActions,
} from '../completeness/completeness-grid';
import type { ShareRequest } from '../export/export-done';
import {
  AccessDetail,
  AskForFullValues,
  RequestsTable,
  askedBy,
  stateOf,
  type FullValuesActions,
  type FullValuesRequest,
  type FullValuesState,
} from '../export/full-values';
import { FORMAT_LABEL, firstName, listed, spokenDate } from '../export/words';
import { useHeld } from '../held';
import { Loaded, type Loadable, type Outcome } from '../load';
import type { SearchPeople } from '../record/attribute-input';
import { DisplayValue } from '../record/display';
import {
  DuplicateDetail,
  Merges,
  bandOf,
  flaggedByOf,
  pairId,
  type DuplicateActions,
  type DuplicatePair,
  type DuplicatesState,
} from './duplicates';
import {
  IdCheckDetail,
  idCheckId,
  verdictOf,
  type DecidedReview,
  type IdCheckActions,
  type IdentifierReviewsState,
  type ReviewItem,
} from './identifier-reviews';

/**
 * Review (design E1–E13, MA E1–E7): every decision and every missing detail,
 * in one queue.
 *
 * Approvals and Data health were two sections with eight tabs between them.
 * Now there is one list and one detail pane. The tabs (routes, drawn by the
 * host's frame) say whose turn it is: Waiting for me, Flagged, I asked,
 * Decided. The chips say what kind: changes, ID checks, possible duplicates,
 * requests for full values, exports waiting to be sent, and missing details,
 * each with its count and its own empty state. Every kind opens in the same
 * pane, with its decision at the foot of it; under a finger the row opens the
 * detail with a back link, "All items", and a pinned two-column decision bar.
 *
 * An employee's Review is their own pending changes, Waiting and Decided; a
 * finance viewer's is their requests for full values. Missing details is a
 * backlog rather than a decision: it is a chip, never counted in the badge.
 *
 * The chip, the item and the fill-in grid live in the address (`?kind=`,
 * `?item=`, `?fill=`), so a link from the bell or an email opens the item,
 * already selected, in the page the server sends.
 */

export type ReviewTab = 'waiting' | 'flagged' | 'asked' | 'decided';
export type ReviewKind = 'changes' | 'ids' | 'duplicates' | 'access' | 'exports' | 'missing';

export interface ReviewState {
  /** When People answered: what every age is read against, the same on the server and in the browser. */
  readonly now: string;
  readonly roles: { readonly hr: boolean; readonly admin: boolean; readonly finance: boolean };
  /** Every reader is People's own, as the viewer: one it refused this viewer is null. */
  readonly approvals: ApprovalsState | null;
  readonly identifiers: IdentifierReviewsState | null;
  readonly duplicates: DuplicatesState | null;
  readonly fullValues: FullValuesState | null;
  readonly completeness: CompletenessState | null;
  /**
   * The requests to send an export this viewer may decide now (E5); null
   * where they decide none. Absent from an older shell.
   */
  readonly shares?: readonly ShareRequest[] | null;
  /**
   * The request to send an export the address names (`?item=export-…`), or
   * null: one the viewer does not decide arrives from the email about it.
   */
  readonly share: ShareRequest | { readonly state: 'missing'; readonly id?: string } | null;
  /**
   * The viewer's own requests, decided (E10): anybody's but HR's, whose
   * Decided is everybody's. Null for HR, or where People refused the read.
   */
  readonly ownDecided?: {
    readonly changes: readonly ApprovalItem[];
    readonly identifiers: readonly DecidedReview[];
  } | null;
}

export interface ReviewProps extends ChangeActions {
  readonly load: Loadable<ReviewState>;
  /** Whose turn: the route's last segment. */
  readonly tab: ReviewTab;
  readonly kind?: string | null;
  readonly onKindChange?: (kind: ReviewKind | null) => void;
  readonly item?: string | null;
  readonly onItemChange?: (item: string | null) => void;
  readonly onReviewIdentifier: IdCheckActions['onDecide'];
  readonly onReveal: IdCheckActions['onReveal'];
  readonly onMerge: DuplicateActions['onMerge'];
  readonly onDismiss: DuplicateActions['onDismiss'];
  readonly onUnmerge: DuplicateActions['onUnmerge'];
  readonly onRequestFullValues: FullValuesActions['onRequest'];
  readonly onDecideFullValues: FullValuesActions['onDecide'];
  readonly onDecideShare?: (id: string, approve: boolean, note: string) => Promise<Outcome>;
  readonly onSaveMissing: MissingActions['onSave'];
  readonly onCheckMissing?: MissingActions['onCheck'];
  readonly onRemindAll?: MissingActions['onRemindAll'];
  readonly onRemind?: MissingActions['onRemind'];
  readonly onNextPage?: MissingActions['onNextPage'];
  readonly onFirstPage?: MissingActions['onFirstPage'];
  readonly fill?: string | null;
  readonly onFillChange?: (personId: string | null) => void;
  readonly searchPeople?: SearchPeople;
}

/* ------------------------------------------------------------- words -- */

const CHIP: Readonly<Record<ReviewKind, string>> = {
  changes: 'Changes',
  ids: 'ID checks',
  duplicates: 'Duplicates',
  access: 'Full values',
  exports: 'Exports',
  missing: 'Missing details',
};

/** Each kind's glyph, on its row and its chip. */
const KIND_ICON: Readonly<Record<ReviewKind, ReactNode>> = {
  changes: <icons.edit aria-hidden />,
  ids: <icons.identifier aria-hidden />,
  duplicates: <icons.merge aria-hidden />,
  access: <icons.sensitive aria-hidden />,
  exports: <icons.send aria-hidden />,
  missing: <icons.missing aria-hidden />,
};

/** Each chip's own empty state (E13), so an empty filter still says what would appear. */
const EMPTY: Readonly<Record<ReviewKind | 'all' | 'mine', { title: string; body: string }>> = {
  all: {
    title: 'Nothing waiting for you',
    body: 'Changes, ID checks, duplicates and requests appear here when they need you.',
  },
  changes: { title: 'Nothing to approve', body: 'All changes have been decided.' },
  ids: {
    title: 'Nothing to review',
    body: 'Every national identifier entered so far passed its country’s checks, or has been reviewed.',
  },
  duplicates: {
    title: 'Nothing looks duplicated',
    body: 'No two records share a work email, a name and birth date, or a unique value.',
  },
  access: { title: 'Nothing to decide', body: 'A request appears here when finance asks.' },
  exports: {
    title: 'Nothing to send',
    body: 'A request appears here when somebody sends an export to a person who can’t see all of it.',
  },
  missing: {
    title: 'Nothing is missing',
    body: 'Every required field has a value for everybody it applies to.',
  },
  mine: { title: 'Nothing waiting', body: 'None of your changes wait for approval.' },
};

/** "6 people", "1 person". */
const peopleCount = (n: number): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? 'person' : 'people'}`;

const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/* -------------------------------------------------------------- rows -- */

/** One row of the queue, whatever its kind: who, what, how long ago, and why it is flagged. */
interface Row {
  /** Its id in the address: `change-…`, `id-…`, `dup-…`, `access-…`, `export-…`. */
  readonly id: string;
  readonly kind: Exclude<ReviewKind, 'missing'>;
  readonly name: string;
  /** Their photo, where People sent one. */
  readonly avatarUrl?: string | null;
  readonly summary: string;
  /** Who asked, when the row's name is not them: "Asked by Marco Ruiz", "Flagged by …". */
  readonly by?: string | null;
  /** When it was asked for, for its age and the order; null for a pair, which has none. */
  readonly at: string | null;
  readonly flag?: string | null;
  readonly badge?: { readonly tone: 'danger' | 'warning'; readonly text: string } | null;
}

const changeRow = (item: ApprovalItem): Row => ({
  id: `change-${item.id}`,
  kind: 'changes',
  name: item.name,
  avatarUrl: item.avatarUrl ?? null,
  summary: summaryOf(item),
  by: `Asked by ${item.requestedBy === 'You' ? 'you' : item.requestedBy}`,
  at: item.requestedAt,
  flag: isClosed(item) ? null : (item.flagSummary ?? null),
});

const idRow = (item: ReviewItem): Row => ({
  id: `id-${idCheckId(item)}`,
  kind: 'ids',
  name: item.name,
  avatarUrl: item.avatarUrl ?? null,
  summary: `${item.label} · ${item.findings[0]?.message ?? ''}`,
  at: item.enteredAt,
  by:
    item.enteredBy == null
      ? null
      : `Entered by ${item.enteredBy === 'You' ? 'you' : item.enteredBy}`,
  badge: verdictOf(item),
});

const pairRow = (pair: DuplicatePair): Row => ({
  id: `dup-${pairId(pair)}`,
  kind: 'duplicates',
  name: pair.names[0] ?? '',
  avatarUrl: pair.avatarUrls?.[0] ?? null,
  summary: `Possible duplicate of ${pair.names[1] ?? ''} · ${pair.reasons.join(', ')}`,
  by: flaggedByOf(pair),
  at: null,
  badge: bandOf(pair) === null ? null : { tone: 'warning', text: bandOf(pair) ?? '' },
});

const accessRow = (r: FullValuesRequest): Row => ({
  id: `access-${r.id}`,
  kind: 'access',
  name: askedBy(r),
  summary: `${r.fields.join(', ')} · ${r.reason}`,
  at: r.requestedAt,
});

const shareRow = (share: ShareRequest): Row => ({
  id: `export-${share.id}`,
  kind: 'exports',
  name: share.requestedBy.name ?? 'A colleague',
  avatarUrl: share.requestedBy.avatarUrl ?? null,
  // "Export to Nora Becker · 6 people" (E5); an older request, uncounted, says why instead.
  summary: `Export to ${share.recipient.name ?? 'a colleague'} · ${
    share.people == null ? share.reason : peopleCount(share.people)
  }`,
  at: share.requestedAt,
});

/** Every request to send an export on the page: those to decide, and the one the address names. */
function sharesOf(state: ReviewState): ShareRequest[] {
  const listed = state.shares ?? [];
  const named = state.share !== null && state.share.state !== 'missing' ? state.share : null;
  return named === null || listed.some((s) => s.id === named.id) ? [...listed] : [...listed, named];
}

/** Newest first, as the queue reads (E1); a pair, undated, after everything dated. */
const newestFirst = (rows: readonly Row[]): Row[] =>
  rows.toSorted((a, b) =>
    a.at === null
      ? b.at === null
        ? 0
        : 1
      : b.at === null
        ? -1
        : Date.parse(b.at) - Date.parse(a.at),
  );

/** The changes in each of HR's tabs, as Approvals split them. */
function splitChanges(approvals: ApprovalsState | null): {
  readonly forMe: readonly ApprovalItem[];
  readonly asked: readonly ApprovalItem[];
  readonly rest: readonly ApprovalItem[];
} {
  const items = approvals?.items ?? [];
  const forMe = items.filter((i) => i.canDecide || i.canSelfApprove === true);
  const asked = items.filter((i) => i.mine && !forMe.includes(i));
  const rest = items.filter((i) => !forMe.includes(i) && !asked.includes(i));
  return { forMe, asked, rest };
}

/** The changes decided that the viewer's Decided lists: their own, or for HR everybody's. */
const decidedChanges = (state: ReviewState): readonly ApprovalItem[] =>
  state.ownDecided?.changes ?? state.approvals?.decided ?? [];

/** Whose Review it is: HR's queue, an employee's own changes, or finance's requests. */
type Viewer = 'hr' | 'finance' | 'employee';

const viewerOf = (state: ReviewState): Viewer =>
  state.roles.hr || state.approvals?.isHr === true
    ? 'hr'
    : state.roles.finance && state.fullValues?.canRequest === true
      ? 'finance'
      : 'employee';

/** The rows of a tab, before a chip narrows them. */
function rowsOf(state: ReviewState, tab: ReviewTab, viewer: Viewer): Row[] {
  const { forMe, asked, rest } = splitChanges(state.approvals);
  const requests = state.fullValues?.requests ?? [];
  if (viewer !== 'hr') {
    return tab === 'decided'
      ? newestFirst(decidedChanges(state).map(changeRow))
      : newestFirst((state.approvals?.items ?? []).map(changeRow));
  }
  switch (tab) {
    case 'waiting':
      return newestFirst([
        ...[...forMe, ...rest].map(changeRow),
        ...(state.identifiers?.items ?? []).map(idRow),
        ...(state.duplicates?.items ?? []).map(pairRow),
        ...requests
          .filter((r) => r.state === 'pending' && !r.mine && state.fullValues?.canDecide === true)
          .map(accessRow),
        ...sharesOf(state)
          .filter((s) => s.state === 'pending')
          .map(shareRow),
      ]);
    case 'flagged':
      return newestFirst(forMe.filter(isFlagged).map(changeRow));
    case 'asked':
      return newestFirst([
        ...asked.map(changeRow),
        ...requests.filter((r) => r.mine && r.state === 'pending').map(accessRow),
      ]);
    case 'decided':
      return [];
  }
}

/** Which chips a tab offers HR, in order. */
const CHIPS: Readonly<Record<ReviewTab, readonly ReviewKind[]>> = {
  waiting: ['changes', 'ids', 'duplicates', 'access', 'exports', 'missing'],
  flagged: [],
  asked: ['changes', 'access'],
  decided: ['changes', 'ids', 'duplicates', 'access'],
};

/* ------------------------------------------------------------ screen -- */

export function Review({ load, ...props }: ReviewProps): JSX.Element {
  return (
    <Loaded load={load} what="what waits for a decision">
      {(state) => <Queue state={state} {...props} />}
    </Loaded>
  );
}

function Queue({
  state,
  tab,
  kind: heldKind,
  onKindChange,
  item: heldItem,
  onItemChange,
  ...actions
}: Omit<ReviewProps, 'load'> & { readonly state: ReviewState }): JSX.Element {
  const viewer = viewerOf(state);
  const chips = viewer === 'hr' ? CHIPS[tab] : [];
  const [chosen, setChosen] = useHeld<string | null>(
    heldKind,
    onKindChange as never,
    heldKind ?? null,
  );
  const kind = chips.find((k) => k === chosen) ?? null;
  const [picked, pick] = useHeld<string | null>(heldItem, onItemChange, heldItem ?? null);
  const now = Date.parse(state.now);
  // A, on a change's row: it opens with the note to write, as its button needs one.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  /** A row's own keys (A and R on a change, M and N on a pair), as its buttons do. */
  const rowActions = (row: Row): readonly RowAction[] | undefined => {
    if (row.kind === 'changes') {
      const item = state.approvals?.items.find((i) => `change-${i.id}` === row.id);
      if (item?.canDecide !== true) return undefined;
      return [
        ...(item.awaitingReview === true
          ? []
          : [
              {
                id: 'approve',
                label: isFlagged(item) ? 'Approve with note' : 'Approve',
                shortcut: 'row.approve',
                onSelect: () => {
                  pick(row.id);
                  setNoteFor(row.id);
                },
              },
            ]),
        {
          id: 'decline',
          label: 'Reject',
          shortcut: 'row.decline',
          onSelect: () => {
            pick(row.id);
          },
        },
      ];
    }
    if (row.kind === 'duplicates') {
      const [a = '', b = ''] = row.id.slice(4).split('~');
      return [
        {
          id: 'compare',
          label: 'Compare or merge',
          shortcut: 'row.merge',
          onSelect: () => {
            pick(row.id);
          },
        },
        {
          id: 'not-same',
          label: 'Not the same person',
          shortcut: 'row.not-same',
          onSelect: () => {
            setRefused(null);
            void actions.onDismiss(a, b).then((outcome) => {
              if (!outcome.ok) setRefused(outcome.message);
            });
          },
        },
      ];
    }
    return undefined;
  };

  const all = rowsOf(state, tab, viewer);
  const rows = kind === null ? all : all.filter((r) => r.kind === kind);
  // Decided counts what it lists (E9): each kind's decisions, and the merges.
  const decisions = tab === 'decided' ? decisionsOf(state) : [];
  const merged = tab === 'decided' ? (state.duplicates?.merges ?? []).length : 0;
  const total = tab === 'decided' ? decisions.length + merged : all.length;
  const countOf = (k: ReviewKind): number =>
    k === 'missing'
      ? (state.completeness?.toFill ?? 0)
      : tab === 'decided'
        ? k === 'duplicates'
          ? merged
          : decisions.filter((d) => d.kind === k).length
        : all.filter((r) => r.kind === k).length;

  const description =
    viewer === 'hr'
      ? 'Every decision and every missing detail, in one place. Nothing here changes a record until someone decides.'
      : viewer === 'finance'
        ? 'Who can see unmasked values, for how long and why: one download, once, within 24 hours of HR’s approval. Every request is logged.'
        : tab === 'decided'
          ? 'Your changes HR decided in the last 90 days.'
          : 'Your changes wait here until HR decides, within 7 days. Your record stays the same until then.';

  const chipRow =
    chips.length === 0 ? null : (
      <ChipGroup
        type="single"
        scroll
        aria-label="What kind"
        value={kind ?? 'all'}
        onValueChange={(next) => {
          if (next === '') return;
          setChosen(next === 'all' ? null : next);
          pick(null);
        }}
      >
        <ChipGroupItem value="all">
          All <span className="opacity-60 tabular-nums">{total}</span>
        </ChipGroupItem>
        {chips.map((k) => (
          <ChipGroupItem key={k} value={k}>
            {CHIP[k]} <span className="opacity-60 tabular-nums">{countOf(k)}</span>
          </ChipGroupItem>
        ))}
      </ChipGroup>
    );

  const body = ((): ReactNode => {
    if (viewer === 'finance' && state.fullValues !== null) {
      return (
        <Finance
          state={state}
          tab={tab}
          rows={rows}
          picked={picked}
          pick={pick}
          now={now}
          actions={actions}
        />
      );
    }
    if (tab === 'decided') {
      return <Decided state={state} kind={kind} viewer={viewer} onUnmerge={actions.onUnmerge} />;
    }
    if (kind === 'missing') {
      return state.completeness === null ? (
        <EmptyState
          icon={<icons.missing />}
          title={EMPTY.missing.title}
          description={EMPTY.missing.body}
        />
      ) : (
        <MissingDetails
          state={state.completeness}
          onSave={actions.onSaveMissing}
          {...(actions.onCheckMissing === undefined ? {} : { onCheck: actions.onCheckMissing })}
          {...(actions.onRemindAll === undefined ? {} : { onRemindAll: actions.onRemindAll })}
          {...(actions.onRemind === undefined ? {} : { onRemind: actions.onRemind })}
          {...(actions.onNextPage === undefined ? {} : { onNextPage: actions.onNextPage })}
          {...(actions.onFirstPage === undefined ? {} : { onFirstPage: actions.onFirstPage })}
          now={now}
          fill={actions.fill ?? null}
          {...(actions.onFillChange === undefined ? {} : { onFillChange: actions.onFillChange })}
          searchPeople={actions.searchPeople}
        />
      );
    }
    const empty =
      tab === 'flagged'
        ? { title: 'Nothing flagged', body: 'No change waiting for you looks unusual.' }
        : viewer !== 'hr' || tab === 'asked'
          ? EMPTY.mine
          : EMPTY[kind ?? 'all'];
    const current = rows.find((r) => r.id === picked) ?? rows[0] ?? null;
    // The Flagged tab's pane explains the checks until a change is picked (E8).
    const explainer =
      tab === 'flagged' ? (
        <Checks
          checks={state.approvals?.checks ?? []}
          canTune={state.approvals?.canTune === true}
          last90={state.approvals?.last90 ?? null}
          onSetCheck={actions.onSetCheck}
        />
      ) : null;
    if (rows.length === 0) {
      return (
        <Stack gap={5}>
          <Card padded>
            <EmptyState
              icon={
                kind === null ? (
                  tab === 'flagged' ? (
                    <icons.flagged />
                  ) : (
                    <icons.success />
                  )
                ) : (
                  KIND_ICON[kind]
                )
              }
              title={empty.title}
              description={empty.body}
            />
          </Card>
          {explainer}
        </Stack>
      );
    }
    const detail =
      tab === 'flagged' && picked === null ? (
        explainer
      ) : current === null ? null : (
        <Detail
          key={current.id}
          row={current}
          state={state}
          now={now}
          actions={actions}
          pick={pick}
          focusNote={noteFor === current.id}
        />
      );
    return (
      <ListDetail
        listWidth="25rem"
        listLabel="Items"
        detailLabel={current === null ? 'Item' : `${current.name}, ${CHIP[current.kind]}`}
        selected={picked !== null}
        onBack={() => {
          pick(null);
        }}
        backLabel="All items"
        list={
          <Rows
            rows={rows}
            current={current?.id ?? null}
            now={now}
            pick={pick}
            actionsOf={rowActions}
          />
        }
        detail={detail}
      />
    );
  })();

  return (
    <Stack gap={4}>
      <PageHeader title="Review" description={description} />
      {chipRow}
      {refused === null ? null : (
        <Alert tone="danger" title="Not done">
          {refused}
        </Alert>
      )}
      {state.share?.state === 'missing' ? (
        <Alert tone="warning" title="This request is not here">
          It was made for somebody else, or it no longer exists.
        </Alert>
      ) : null}
      {body}
    </Stack>
  );
}

/** The queue (E1): each row its person, its age, its kind and what it is, and why it is flagged. */
function Rows({
  rows,
  current,
  now,
  pick,
  actionsOf,
}: {
  readonly rows: readonly Row[];
  readonly current: string | null;
  readonly now: number;
  readonly pick: (id: string | null) => void;
  readonly actionsOf?: (row: Row) => readonly RowAction[] | undefined;
}): JSX.Element {
  return (
    // J and K through the rows; A and R decide a change, as its buttons do.
    <List navigable aria-label="Waiting for a decision">
      {rows.map((row) => (
        <ListItem
          key={row.id}
          asChild
          selected={row.id === current}
          {...((): { actions?: readonly RowAction[] } => {
            const actions = actionsOf?.(row);
            return actions === undefined ? {} : { actions };
          })()}
          leading={<Avatar size="lg" name={row.name} src={row.avatarUrl ?? undefined} />}
          description={
            <span className="flex min-w-0 items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
              {KIND_ICON[row.kind]}
              <span className="truncate">{row.summary}</span>
            </span>
          }
          {...(row.flag || row.by
            ? {
                supporting: (
                  <>
                    {row.by ? <span className="block truncate">{row.by}</span> : null}
                    {row.flag ? (
                      <span className="block font-medium text-warning-fg">
                        <icons.flagged aria-hidden className="me-1.5 inline size-3 align-[-1px]" />
                        {row.flag}
                      </span>
                    ) : null}
                  </>
                ),
              }
            : {})}
          {...(row.badge == null
            ? {}
            : {
                trailing: (
                  <Badge size="sm" tone={row.badge.tone}>
                    {row.badge.text}
                  </Badge>
                ),
              })}
          {...(row.at === null ? {} : { meta: ago(row.at, now) })}
        >
          <button
            type="button"
            aria-current={row.id === current ? true : undefined}
            onClick={() => {
              pick(row.id);
            }}
          >
            {row.name}
            <span className="sr-only">, {CHIP[row.kind]}</span>
          </button>
        </ListItem>
      ))}
    </List>
  );
}

type Actions = Omit<
  ReviewProps,
  'load' | 'tab' | 'kind' | 'onKindChange' | 'item' | 'onItemChange'
>;

/** One item, whatever its kind, in the same pane (E1–E5). */
function Detail({
  row,
  state,
  now,
  actions,
  pick,
  focusNote = false,
}: {
  readonly row: Row;
  readonly state: ReviewState;
  readonly now: number;
  readonly actions: Actions;
  readonly pick: (id: string | null) => void;
  readonly focusNote?: boolean;
}): JSX.Element | null {
  const isHr = viewerOf(state) === 'hr';
  switch (row.kind) {
    case 'changes': {
      const item = [...(state.approvals?.items ?? []), ...decidedChanges(state)].find(
        (i) => `change-${i.id}` === row.id,
      );
      return item === undefined ? null : (
        <ChangeDetail
          item={item}
          isHr={isHr}
          now={now}
          focusNote={focusNote}
          onDecide={actions.onDecide}
          onWithdraw={actions.onWithdraw}
          onSelfApprove={actions.onSelfApprove}
          onOpen={actions.onOpen}
          onMarkNotUnusual={actions.onMarkNotUnusual}
          onAsk={actions.onAsk}
          onAnswer={actions.onAnswer}
        />
      );
    }
    case 'ids': {
      const item = state.identifiers?.items.find((i) => `id-${idCheckId(i)}` === row.id);
      return item === undefined ? null : (
        <IdCheckDetail
          item={item}
          onDecide={actions.onReviewIdentifier}
          onReveal={actions.onReveal}
        />
      );
    }
    case 'duplicates': {
      const pair = state.duplicates?.items.find((p) => `dup-${pairId(p)}` === row.id);
      const comparison = state.duplicates?.comparison ?? null;
      if (comparison !== null && `dup-${comparison.people.map((p) => p.id).join('~')}` === row.id) {
        return (
          <DuplicateDetail
            pair={pair}
            people={comparison.people}
            rows={comparison.rows}
            onMerge={actions.onMerge}
            onDismiss={actions.onDismiss}
          />
        );
      }
      // Compared on People's side: picking it asks for the two records side by side.
      return (
        <Card padded className="flex flex-col items-start gap-3">
          <h2 className="text-md font-bold">
            {pair?.names.join(' and ') ?? row.name}
            <span className="font-normal text-fg-muted"> · Possible duplicate</span>
          </h2>
          <p className="text-sm text-fg-muted">
            {[pair?.reasons.join(', '), flaggedByOf(pair)].filter((x) => x).join(' · ')}
          </p>
          <Button
            variant="primary"
            startIcon={<icons.merge aria-hidden />}
            onClick={() => {
              pick(row.id);
            }}
          >
            Compare
          </Button>
        </Card>
      );
    }
    case 'access': {
      const request = state.fullValues?.requests.find((r) => `access-${r.id}` === row.id);
      if (request === undefined) return null;
      return request.mine || request.state !== 'pending' ? (
        <RequestCard request={request} />
      ) : (
        <AccessDetail request={request} onDecide={actions.onDecideFullValues} />
      );
    }
    case 'exports': {
      const share = sharesOf(state).find((s) => `export-${s.id}` === row.id);
      return share === undefined ? null : (
        <ExportDetail share={share} onDecide={actions.onDecideShare} />
      );
    }
  }
}

/** One's own request for full values, read-only: what it waits on. */
function RequestCard({ request }: { readonly request: FullValuesRequest }): JSX.Element {
  const shown = stateOf(request);
  return (
    <Card padded className="flex flex-col gap-4">
      <h2 className="text-md font-bold">Full values: {request.fields.join(', ')}</h2>
      <KeyValues
        layout="aligned"
        labelWidth="7.5rem"
        items={[
          { label: 'Asked', value: shortDay(request.requestedAt) },
          { label: 'Reason', value: `“${request.reason}”` },
          { label: 'State', value: <Badge tone={shown.tone}>{shown.text}</Badge> },
        ]}
      />
    </Card>
  );
}

/**
 * An export waiting to be sent (E5): somebody wants to send a file to a
 * person who cannot see all of it, and a People administrator who is neither
 * decides. What it holds, what the recipient could not read, and Reject or
 * Approve and send, with an optional note.
 */
function ExportDetail({
  share,
  onDecide,
}: {
  readonly share: ShareRequest;
  readonly onDecide: ReviewProps['onDecideShare'];
}): JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const asker = share.requestedBy.name ?? 'A colleague';
  const them = firstName(share.recipient.name);
  const decided = share.state !== 'pending';
  const decide = (approve: boolean): void => {
    if (onDecide === undefined) return;
    setBusy(approve ? 'approve' : 'reject');
    setFailed(null);
    void onDecide(share.id, approve, note).then((done) => {
      setBusy(null);
      if (!done.ok) setFailed(done.message);
    });
  };
  return (
    <Card padded className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar size="xl" name={asker} src={share.requestedBy.avatarUrl ?? undefined} />
        <div className="min-w-0 flex-1">
          <h2 className="text-md font-bold">
            {asker}
            <span className="font-normal text-fg-muted">
              {' '}
              · wants to send an export to {share.recipient.name ?? them}
            </span>
          </h2>
          <p className="text-sm text-fg-muted">
            Asked {shortDay(share.requestedAt)}
            {decided ? '' : ` · waits until ${shortDay(share.expiresAt)}`}
          </p>
        </div>
        {decided ? (
          <Badge size="sm" tone={share.state === 'approved' ? 'success' : 'neutral'}>
            {share.state === 'approved'
              ? 'Sent'
              : share.state === 'rejected'
                ? 'Rejected'
                : 'Lapsed'}
          </Badge>
        ) : null}
      </div>
      {share.gap === null || share.gap.fields.length === 0 ? null : (
        <Alert
          tone="warning"
          icon={<icons.locked aria-hidden />}
          title={`${them} can’t see all of it`}
        >
          {listed(
            share.gap.fields.map(
              (f) =>
                `${f.label} is outside what ${them} can see for ${String(f.people)} ${f.people === 1 ? 'person' : 'people'}`,
            ),
          )}
          {share.gap.unlisted > 0
            ? `, and ${String(share.gap.unlisted)} people ${them} can’t see at all`
            : ''}
          . Approving sends this one file, built as {firstName(asker)} sees it; it changes nothing
          else {them} can see.
        </Alert>
      )}
      <KeyValues
        layout="aligned"
        labelWidth="7.5rem"
        items={[
          {
            label: 'Who',
            value: [
              (share.audience ?? 'Everybody you can see').replace(/\byou\b/u, firstName(asker)),
              share.people == null ? null : peopleCount(share.people),
            ]
              .filter((x) => x !== null)
              .join(' · '),
          },
          { label: 'Fields', value: listed(share.fields) },
          {
            label: 'As of',
            value: share.asOf === null ? 'The day it is sent' : spokenDate(share.asOf),
          },
          { label: 'Format', value: FORMAT_LABEL[share.format] },
          { label: 'Reason', value: `“${share.reason}”` },
        ]}
      />
      {decided && share.note !== null ? (
        <p className="text-sm text-fg-muted">“{share.note}”</p>
      ) : null}
      {share.canDecide && onDecide !== undefined ? (
        <>
          <Field>
            <FieldLabel>Note</FieldLabel>
            <FieldControl>
              <Textarea
                value={note}
                maxLength={500}
                rows={2}
                placeholder="Optional. Shown to whoever asked."
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          {failed === null ? null : (
            <Alert tone="danger" title="Not decided">
              {failed}
            </Alert>
          )}
          <div
            {...PINNED_BAR}
            className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4 touch:sticky touch:bottom-24 touch:z-10 touch:grid touch:grid-cols-2 touch:bg-surface touch:py-2"
          >
            <Button
              loading={busy === 'reject'}
              loadingLabel="Rejecting"
              onClick={() => {
                decide(false);
              }}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              startIcon={<icons.send aria-hidden />}
              loading={busy === 'approve'}
              loadingLabel="Approving"
              onClick={() => {
                decide(true);
              }}
            >
              Approve and send
            </Button>
          </div>
        </>
      ) : null}
    </Card>
  );
}

/** One decision on Decided (E9), whatever its kind. */
interface Decision {
  readonly key: string;
  readonly kind: 'changes' | 'ids' | 'access';
  readonly name: string;
  readonly avatarUrl?: string | null;
  readonly what: ReactNode;
  readonly outcome: { readonly tone: ComponentProps<typeof Badge>['tone']; readonly text: string };
  readonly by: string;
  readonly when: string | null;
}

/** Every decision of the last 90 days the viewer may see, newest first. */
function decisionsOf(state: ReviewState): Decision[] {
  const changes = decidedChanges(state).map((c): Decision => ({
    key: `change-${c.id}`,
    kind: 'changes',
    name: c.name,
    avatarUrl: c.avatarUrl ?? null,
    what:
      c.before !== undefined && c.readable ? (
        // One's own (E10): the field, what it held → what was asked for, from when.
        <>
          {c.label}: <DisplayValue field={asField(c)} value={c.before} /> →{' '}
          <DisplayValue field={asField(c)} value={c.value} /> · from {shortDay(c.effectiveFrom)}
          {c.note ? ` · Note: “${c.note}”` : ''}
        </>
      ) : (
        [
          `${c.label} change`,
          isFlagged(c)
            ? `Flagged when decided: ${c.flagSummary ?? (c.flags ?? []).map((f) => f.title).join(', ')}`
            : null,
          c.note ? `Note: “${c.note}”` : null,
        ]
          .filter((x) => x !== null)
          .join(' · ')
      ),
    outcome:
      c.state === 'approved'
        ? { tone: 'success', text: 'Approved' }
        : c.state === 'lapsed'
          ? { tone: 'neutral', text: 'Lapsed' }
          : c.state === 'withdrawn'
            ? { tone: 'neutral', text: 'Withdrawn' }
            : { tone: 'danger', text: 'Rejected' },
    by:
      c.state === 'lapsed'
        ? 'Nobody, in 7 days'
        : c.state === 'withdrawn'
          ? 'You'
          : (c.decidedBy ?? 'HR'),
    when: c.decidedAt ?? null,
  }));
  const ids = (state.ownDecided?.identifiers ?? state.identifiers?.decided ?? []).map(
    (r): Decision => ({
      key: `id-${r.personId}-${r.label}-${r.decidedAt}`,
      kind: 'ids',
      name: r.name,
      what: [`ID check: ${r.label}`, r.note ? `Note: “${r.note}”` : null]
        .filter((x) => x !== null)
        .join(' · '),
      outcome:
        r.outcome === 'accepted'
          ? { tone: 'success', text: 'Accepted' }
          : { tone: 'danger', text: 'Sent back' },
      by: r.decidedBy,
      when: r.decidedAt,
    }),
  );
  const requests = (state.fullValues?.requests ?? [])
    .filter((r) => r.state !== 'pending')
    .map((r): Decision => ({
      key: `access-${r.id}`,
      kind: 'access',
      name: askedBy(r),
      what: `Full values: ${r.fields.join(', ')}${r.note === null ? '' : ` · “${r.note}”`}`,
      outcome: stateOf(r),
      by: '—',
      when: r.requestedAt,
    }));
  return [...changes, ...ids, ...requests].toSorted((a, b) =>
    (b.when ?? '').localeCompare(a.when ?? ''),
  );
}

/**
 * Decided (E9): every kind for 90 days, with who decided and when, and the
 * merged records underneath with Undo, or why it cannot be undone.
 */
function Decided({
  state,
  kind,
  viewer,
  onUnmerge,
}: {
  readonly state: ReviewState;
  readonly kind: ReviewKind | null;
  readonly viewer: Viewer;
  readonly onUnmerge: DuplicateActions['onUnmerge'];
}): JSX.Element {
  const decisions = decisionsOf(state).filter((d) => kind === null || d.kind === kind);
  const merges =
    viewer === 'hr' && (kind === null || kind === 'duplicates')
      ? (state.duplicates?.merges ?? [])
      : [];
  if (decisions.length === 0 && merges.length === 0) {
    return (
      <Card padded>
        <EmptyState
          icon={<icons.history />}
          title="Nothing decided lately"
          description="Changes decided in the last 90 days appear here."
        />
      </Card>
    );
  }
  return (
    <Stack gap={4}>
      {decisions.length === 0 ? null : (
        <PageSection surface title="Decided in the last 90 days">
          <Table aria-label="Decided in the last 90 days">
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>By</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decisions.map((d) => (
                <TableRow key={d.key}>
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar size="sm" name={d.name} src={d.avatarUrl ?? undefined} />
                      <span className="truncate">{d.name}</span>
                    </span>
                  </TableCell>
                  <TableCell>{d.what}</TableCell>
                  <TableCell>
                    <Badge size="sm" tone={d.outcome.tone}>
                      {d.outcome.text}
                    </Badge>
                  </TableCell>
                  <TableCell>{d.by}</TableCell>
                  <TableCell>{d.when == null ? '—' : shortDay(d.when)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PageSection>
      )}
      <Merges merges={merges} onUnmerge={onUnmerge} />
    </Stack>
  );
}

/**
 * Finance's Review (E11, MA E7): the form to ask for full values beside every
 * request of theirs with its state and the one download, and their own
 * changes, if any wait.
 */
function Finance({
  state,
  tab,
  rows,
  picked,
  pick,
  now,
  actions,
}: {
  readonly state: ReviewState;
  readonly tab: ReviewTab;
  readonly rows: readonly Row[];
  readonly picked: string | null;
  readonly pick: (id: string | null) => void;
  readonly now: number;
  readonly actions: Actions;
}): JSX.Element {
  const fullValues = state.fullValues;
  const requests = (fullValues?.requests ?? []).filter((r) => r.mine);
  const shown = tab === 'decided' ? requests.filter((r) => r.state !== 'pending') : requests;
  const current = rows.find((r) => r.id === picked) ?? rows[0] ?? null;
  return (
    <Stack gap={5}>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 @5xl/page:grid-cols-[26.25rem_minmax(0,1fr)]">
        {tab === 'decided' || fullValues === null ? null : (
          <PageSection surface title="Ask for full values">
            <AskForFullValues state={fullValues} onRequest={actions.onRequestFullValues} />
          </PageSection>
        )}
        <PageSection
          surface
          title={tab === 'decided' ? 'Decided' : 'Your requests'}
          className={tab === 'decided' ? '@5xl/page:col-span-2' : undefined}
        >
          {shown.length === 0 ? (
            <EmptyState
              icon={<icons.sensitive />}
              title={tab === 'decided' ? 'Nothing decided lately' : 'No requests yet'}
              description={
                tab === 'decided'
                  ? 'Requests HR decided appear here.'
                  : 'Ask for the fields you need, and say why.'
              }
            />
          ) : (
            <RequestsTable label="Your requests" requests={shown} />
          )}
        </PageSection>
      </div>
      {rows.length === 0 ? null : (
        <PageSection title={tab === 'decided' ? 'Your changes, decided' : 'Your changes'}>
          <ListDetail
            listWidth="25rem"
            listLabel="Your changes"
            detailLabel={current === null ? 'Change' : current.summary}
            selected={picked !== null}
            onBack={() => {
              pick(null);
            }}
            backLabel="All items"
            list={<Rows rows={rows} current={current?.id ?? null} now={now} pick={pick} />}
            detail={
              current === null ? null : (
                <Detail
                  key={current.id}
                  row={current}
                  state={state}
                  now={now}
                  actions={actions}
                  pick={pick}
                />
              )
            }
          />
        </PageSection>
      )}
    </Stack>
  );
}
