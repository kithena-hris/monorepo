import {
  Alert,
  AssistantCard,
  Avatar,
  Badge,
  Button,
  Card,
  ChangeDiff,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  HorizontalBarChart,
  IconList,
  IconListItem,
  List,
  ListDetail,
  ListItem,
  PageHeader,
  PageSection,
  PINNED_BAR,
  Stack,
  Stat,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  icons,
} from '@reach/ui';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import { useHeld } from '../held';
import { Loaded, type Loadable, type Outcome } from '../load';
import { DisplayValue, longDate } from '../record/display';
import type { AttributeValue, PendingValue, RecordField } from '../record/model';
import { ApproveAlone, PendingBadge } from '../record/pending';

/**
 * The approvals inbox (PEO-077; PRD §8.6), and flagged approvals (design AI7,
 * AI8, MA6, MA7).
 *
 * A change to a sensitive field — a bank account, a salary, whatever the
 * tenant switched on — is held, not applied, until somebody other than the
 * requester and the person it is about approves it. HR sees every change
 * waiting here, oldest first, with the value asked for beside the value in
 * force; anybody else sees their own, and may withdraw one, or answer a
 * question about it. Undecided after seven days, a change lapses.
 *
 * **Flags.** People's checks (rules, never a model) flag a change that looks
 * unusual, for whoever decides it: why, in plain words, with the numbers it
 * compared against and an honest note that it might be fine. A flag never
 * approves or rejects anything. Approving a flagged change asks for a note;
 * "Not unusual" teaches the checks; the decider may ask the requester first.
 * The Flagged tab lists them and says what Kithena checks, with a switch per
 * check for a People administrator, and the last 90 days.
 *
 * Two exceptions, both People's rules shown here. When no other HR member may
 * approve a change, the requester approves it alone, after a dialog that says
 * so. And a national identifier our checks doubt is reviewed before it is
 * approved, under Identifiers to review.
 */

export interface ApprovalFlag {
  readonly code: string;
  readonly title: string;
  /** What it compared against. Empty on a decided change, where only the check is kept. */
  readonly detail: string;
}

export interface ApprovalComparison {
  readonly label: string;
  /** A whole percentage. */
  readonly percent: string;
  readonly highlight: boolean;
}

export interface ApprovalQuestion {
  readonly id: string;
  readonly question: string;
  readonly askedBy: string;
  readonly askedAt: string;
  readonly answer: string | null;
  readonly answeredAt: string | null;
  readonly canAnswer: boolean;
}

export interface ApprovalItem extends PendingValue {
  readonly personId: string;
  readonly name: string;
  /** False where the viewer may not read the field: they decide on who, when and why. */
  readonly readable: boolean;
  /** What is in force now, masked as the field is. */
  readonly current: AttributeValue;
  /** Why People's checks flag it: only for whoever decides it. A flag informs; it never stops a decision. */
  readonly flags?: readonly ApprovalFlag[];
  readonly comparisons?: readonly ApprovalComparison[];
  readonly flagNote?: string | null;
  /** The reasons in one line, for a row. */
  readonly flagSummary?: string | null;
  readonly canAsk?: boolean;
  readonly canMark?: boolean;
  readonly questions?: readonly ApprovalQuestion[];
  readonly state?: 'pending' | 'approved' | 'rejected';
  readonly decidedBy?: string | null;
  readonly decidedAt?: string | null;
  readonly note?: string | null;
}

export interface ApprovalCheck {
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly on: boolean;
}

export interface ApprovalsState {
  readonly isHr: boolean;
  readonly items: readonly ApprovalItem[];
  /** HR's: decided in the last 90 days, newest first. */
  readonly decided?: readonly ApprovalItem[];
  /** What Kithena checks (AI8), for HR. */
  readonly checks?: readonly ApprovalCheck[] | null;
  /** A People administrator switches the checks. */
  readonly canTune?: boolean;
  readonly last90?: {
    readonly flagged: number;
    readonly rejected: number;
    readonly marked: number;
  } | null;
}

export type ApprovalsTab = 'mine' | 'flagged' | 'asked' | 'decided';

export interface ApprovalsProps {
  readonly load: Loadable<ApprovalsState>;
  readonly onDecide: (changeId: string, approve: boolean, note: string | null) => Promise<Outcome>;
  readonly onWithdraw: (changeId: string) => Promise<Outcome>;
  /** A requester no other HR member can approve for, approving their own change, once they confirm (PEO-077). */
  readonly onSelfApprove?: (changeId: string, note?: string | null) => Promise<Outcome>;
  readonly onOpen?: (personId: string) => void;
  /** HR's tab (`?tab=`). Absent: whichever has something. */
  readonly tab?: ApprovalsTab | null;
  readonly onTabChange?: (tab: ApprovalsTab) => void;
  /** The change open beside the list (`?change=`). */
  readonly change?: string | null;
  readonly onChangeOpen?: (change: string | null) => void;
  /** Its flags were not worth raising: the checks learn from it. */
  readonly onMarkNotUnusual?: (changeId: string) => Promise<Outcome>;
  /** Ask the requester before deciding. */
  readonly onAsk?: (changeId: string, question: string) => Promise<Outcome>;
  /** The requester answers a question about their change. */
  readonly onAnswer?: (questionId: string, answer: string) => Promise<Outcome>;
  /** A People administrator switches a check. */
  readonly onSetCheck?: (code: string, on: boolean) => Promise<Outcome>;
}

/** Enough of a field to draw a value: a pending value carries no options or type. */
const asField = (item: ApprovalItem): RecordField => ({
  key: item.key,
  label: item.label,
  description: null,
  dataType: 'text',
  options: [],
  required: false,
  readOnly: true,
  sensitive: true,
});

/** Each check's glyph: the reason's subject, from Reach's own set. */
const CHECK_ICON: Readonly<Record<string, ReactNode>> = {
  raise: <icons.analytics aria-hidden />,
  band: <icons.payroll aria-hidden />,
  bank_after_contact: <icons.payment aria-hidden />,
  close_colleagues: <icons.team aria-hidden />,
  payroll_closing: <icons.calendar aria-hidden />,
  unusual_time: <icons.night aria-hidden />,
};
const iconOf = (code: string): ReactNode => CHECK_ICON[code] ?? <icons.flagged aria-hidden />;

const flagsOf = (item: ApprovalItem): readonly ApprovalFlag[] => item.flags ?? [];
const isFlagged = (item: ApprovalItem): boolean => flagsOf(item).length > 0;

/** "€84k": short money for a row. */
function compact(value: AttributeValue): string | null {
  if (value === null || typeof value !== 'object' || !('amountMinor' in value)) return null;
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency: value.currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  // Display only: a whole thousand, never arithmetic on the amount.
  const major = Number(value.amountMinor.slice(0, Math.max(0, value.amountMinor.length - digits)) || '0');
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: value.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(major)
    .replace(/K$/u, 'k');
}

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "Salary €61k → €84k · from 1 Oct", or the field and the date where no amount shows. */
function summaryOf(item: ApprovalItem): string {
  const from = `from ${shortDate.format(Date.parse(`${item.effectiveFrom}T00:00:00Z`))}`;
  const after = item.readable ? compact(item.value) : null;
  // A decided change keeps what was asked for, not what was in force before it.
  if (item.state === 'approved' || item.state === 'rejected') {
    return after === null ? `${item.label} · ${from}` : `${item.label} ${after} · ${from}`;
  }
  const before = item.readable ? compact(item.current) : null;
  return before !== null && after !== null
    ? `${item.label} ${before} → ${after} · ${from}`
    : `${item.label} · ${from}`;
}

/** "12m", "3h", "Yesterday", "4 days": how long ago it was asked for. */
function ago(at: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
  if (minutes < 60) return `${String(Math.max(minutes, 1))}m`;
  if (minutes < 24 * 60) return `${String(Math.floor(minutes / 60))}h`;
  const days = Math.floor(minutes / (24 * 60));
  return days === 1 ? 'Yesterday' : `${String(days)} days`;
}

/** How long until it lapses, in days: "2 days left". */
function daysLeft(expiresAt: string, now: number): string {
  const days = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 86_400_000));
  return days === 0 ? 'Expires today' : `${String(days)} ${days === 1 ? 'day' : 'days'} left`;
}

/** "Nora" from "Nora Becker"; "the requester" when it is not a name. */
const firstName = (name: string): string =>
  name === 'You' || name.startsWith('A ') || name.startsWith('An ')
    ? 'the requester'
    : (name.split(' ')[0] ?? name);

export function Approvals({ load, ...props }: ApprovalsProps): JSX.Element {
  return (
    <Loaded load={load} what="changes waiting for approval">
      {(state) => <Inbox state={state} {...props} />}
    </Loaded>
  );
}

function Inbox({
  state,
  onDecide,
  onWithdraw,
  onSelfApprove,
  onOpen,
  tab: heldTab,
  onTabChange,
  change: heldChange,
  onChangeOpen,
  onMarkNotUnusual,
  onAsk,
  onAnswer,
  onSetCheck,
}: Omit<ApprovalsProps, 'load'> & { readonly state: ApprovalsState }): JSX.Element {
  const [refused, setRefused] = useState<string | null>(null);
  const forMe = state.items.filter((i) => i.canDecide || i.canSelfApprove === true);
  const asked = state.items.filter((i) => i.mine && !forMe.includes(i));
  const rest = state.items.filter((i) => !forMe.includes(i) && !asked.includes(i));
  const flagged = forMe.filter(isFlagged);
  const decided = state.decided ?? [];
  const [tab, setTab] = useHeld<ApprovalsTab>(
    heldTab,
    onTabChange,
    forMe.length > 0 || !state.isHr ? 'mine' : 'asked',
  );
  const shown = !state.isHr
    ? state.items
    : tab === 'mine'
      ? [...forMe, ...rest]
      : tab === 'flagged'
        ? flagged
        : tab === 'asked'
          ? asked
          : decided;
  const [picked, setPicked] = useHeld<string | null>(heldChange, onChangeOpen, null);
  const current = shown.find((i) => i.id === picked) ?? shown[0] ?? null;
  const [now] = useState(() => Date.now());
  // A, on a row: its change opens with the note to write, as the button needs one.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const pick = (id: string | null): void => {
    setPicked(id);
  };

  const list = (
    // J and K through the changes; A approves the focused one and R rejects
    // it, the same as the buttons beside it.
    <List navigable aria-label="Changes waiting for a decision">
      {shown.map((item) => (
        <ListItem
          key={item.id}
          asChild
          selected={item.id === current?.id}
          {...(item.canDecide
            ? {
                actions: [
                  ...(item.awaitingReview === true
                    ? []
                    : [
                        {
                          id: 'approve',
                          label: isFlagged(item) ? 'Approve with note' : 'Approve',
                          shortcut: 'row.approve',
                          onSelect: () => {
                            pick(item.id);
                            setNoteFor(item.id);
                          },
                        },
                      ]),
                  {
                    id: 'decline',
                    label: 'Reject',
                    shortcut: 'row.decline',
                    onSelect: () => {
                      pick(item.id);
                    },
                  },
                ],
              }
            : {})}
          leading={<Avatar size="lg" name={item.name} />}
          description={summaryOf(item)}
          {...(item.flagSummary
            ? {
                supporting: (
                  <span className="font-medium text-warning-fg">
                    <icons.flagged aria-hidden className="me-1.5 inline size-3 align-[-1px]" />
                    {item.flagSummary}
                  </span>
                ),
              }
            : {})}
          meta={
            item.state === 'approved' || item.state === 'rejected'
              ? item.state === 'approved'
                ? 'Approved'
                : 'Rejected'
              : ago(item.requestedAt, now)
          }
        >
          <button
            type="button"
            aria-current={item.id === current?.id ? true : undefined}
            onClick={() => {
              pick(item.id);
            }}
          >
            {item.name}
            {isFlagged(item) && item.state !== 'approved' && item.state !== 'rejected' ? (
              <Badge size="sm" tone="warning" className="ms-2">
                <icons.flagged aria-hidden />
                Unusual
              </Badge>
            ) : null}
          </button>
        </ListItem>
      ))}
    </List>
  );

  const detail =
    current === null ? null : (
      <Detail
        key={current.id}
        item={current}
        isHr={state.isHr}
        now={now}
        focusNote={noteFor === current.id}
        onDecide={onDecide}
        onWithdraw={() => {
          setRefused(null);
          void onWithdraw(current.id).then((outcome) => {
            if (!outcome.ok) setRefused(outcome.message);
          });
        }}
        onSelfApprove={onSelfApprove}
        onOpen={onOpen}
        onMarkNotUnusual={onMarkNotUnusual}
        onAsk={onAsk}
        onAnswer={onAnswer}
      />
    );

  const listDetail =
    shown.length === 0 ? (
      <EmptyState
        title={
          tab === 'flagged'
            ? 'Nothing flagged'
            : tab === 'decided'
              ? 'Nothing decided lately'
              : 'Nothing to approve'
        }
        description={
          tab === 'flagged'
            ? 'No change waiting for you looks unusual.'
            : tab === 'decided'
              ? 'Changes decided in the last 90 days appear here.'
              : 'All changes have been decided.'
        }
      />
    ) : (
      <ListDetail
        listWidth="26.25rem"
        listLabel="Changes"
        detailLabel={current === null ? 'Change' : `${current.name}’s ${current.label}`}
        selected={picked !== null}
        onBack={() => {
          pick(null);
        }}
        backLabel="All changes"
        list={list}
        detail={detail}
      />
    );

  return (
    <Stack gap={5}>
      <PageHeader
        title={state.isHr ? 'Approvals' : 'Your pending changes'}
        description={
          state.isHr
            ? 'Changes to sensitive fields wait here until someone other than the requester decides.'
            : 'HR reviews each change within 7 days. Your record stays the same until then.'
        }
      />
      {refused === null ? null : (
        <Alert tone="danger" title="Couldn’t complete that">
          {refused}
        </Alert>
      )}
      {state.isHr ? (
        <Tabs
          value={tab}
          onValueChange={(next) => {
            if (next === 'mine' || next === 'flagged' || next === 'asked' || next === 'decided') {
              setTab(next);
            }
            pick(null);
          }}
        >
          <TabsList aria-label="Whose changes">
            <TabsTrigger value="mine">
              Waiting for me{' '}
              <Badge size="xs" variant="solid" tone="danger">
                {forMe.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="flagged">
              <icons.flagged aria-hidden /> Flagged <Badge size="xs">{flagged.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="asked">
              I asked <Badge size="xs">{asked.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="decided">Decided</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="pt-4">
            <Stack gap={5}>
              {tab === 'flagged' && flagged.length === 0 ? null : listDetail}
              {tab === 'flagged' ? (
                <Checks
                  checks={state.checks ?? []}
                  canTune={state.canTune === true}
                  last90={state.last90 ?? null}
                  onSetCheck={onSetCheck}
                />
              ) : null}
            </Stack>
          </TabsContent>
        </Tabs>
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing waiting" description="None of your changes wait for approval." />
      ) : (
        listDetail
      )}
    </Stack>
  );
}

/**
 * One change, to decide (AI7, MA7): who asked, the value in force beside the
 * one asked for, why it is flagged, a note, and the decision.
 */
function Detail({
  item,
  isHr,
  now,
  focusNote,
  onDecide,
  onWithdraw,
  onSelfApprove,
  onOpen,
  onMarkNotUnusual,
  onAsk,
  onAnswer,
}: {
  readonly item: ApprovalItem;
  readonly isHr: boolean;
  readonly now: number;
  readonly focusNote: boolean;
  readonly onDecide: ApprovalsProps['onDecide'];
  readonly onWithdraw: () => void;
  readonly onSelfApprove: ApprovalsProps['onSelfApprove'];
  readonly onOpen: ApprovalsProps['onOpen'];
  readonly onMarkNotUnusual: ApprovalsProps['onMarkNotUnusual'];
  readonly onAsk: ApprovalsProps['onAsk'];
  readonly onAnswer: ApprovalsProps['onAnswer'];
}): JSX.Element {
  const field = asField(item);
  const flags = flagsOf(item);
  const flaggedNow = flags.length > 0;
  const decided = item.state === 'approved' || item.state === 'rejected';
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'mark' | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [needsNote, setNeedsNote] = useState(false);
  const [asking, setAsking] = useState(false);
  const requester = firstName(item.requestedBy);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusNote) noteRef.current?.focus();
  }, [focusNote]);

  const decide = (approve: boolean): void => {
    const said = note.trim();
    if (approve && flaggedNow && said === '') {
      setNeedsNote(true);
      noteRef.current?.focus();
      return;
    }
    setBusy(approve ? 'approve' : 'reject');
    setRefused(null);
    void onDecide(item.id, approve, said === '' ? null : said).then((outcome) => {
      setBusy(null);
      if (!outcome.ok) setRefused(outcome.message);
    });
  };

  return (
    // Not a landmark of its own: the list-detail's pane is the region, named for it.
    <Card padded className="flex flex-col gap-3.5">
      <div className="flex items-start gap-3">
        <Avatar size="xl" name={item.name} />
        <div className="min-w-0 flex-1">
          <h2 className="text-md font-bold">
            {onOpen === undefined ? (
              item.name
            ) : (
              <Button
                variant="link"
                className="p-0 text-md font-bold"
                onClick={() => {
                  onOpen(item.personId);
                }}
              >
                {item.name}
              </Button>
            )}
            <span className="font-normal text-fg-muted"> · {item.label.toLowerCase()} change</span>
          </h2>
          <p className="text-sm text-fg-muted">
            Asked by {item.requestedBy} on {longDate(item.requestedAt.slice(0, 10))}
            {decided
              ? ` · ${item.state === 'approved' ? 'approved' : 'rejected'} by ${item.decidedBy ?? 'HR'}${
                  item.decidedAt ? ` on ${longDate(item.decidedAt.slice(0, 10))}` : ''
                }`
              : ` · expires in ${daysLeft(item.expiresAt, now).replace(' left', '').toLowerCase()}`}
          </p>
          {item.awaitingReview === true || (!item.canDecide && !decided) ? (
            <span className="mt-2 flex flex-wrap items-center gap-2">
              <PendingBadge pending={item} />
            </span>
          ) : null}
        </div>
      </div>
      {item.readable && decided ? (
        // What was asked for; what was in force before it is not kept with the decision.
        <p className="text-sm">
          {item.label}: <DisplayValue field={field} value={item.value} />, from{' '}
          {longDate(item.effectiveFrom)}
        </p>
      ) : item.readable ? (
        <ChangeDiff
          items={[
            {
              label: item.kind === 'correction' ? `${item.label} (correction)` : item.label,
              before: <DisplayValue field={field} value={item.current} />,
              after: <DisplayValue field={field} value={item.value} />,
            },
            { label: 'Effective', before: '—', after: longDate(item.effectiveFrom) },
          ]}
        />
      ) : (
        <p className="text-sm text-fg-muted">
          You can’t view this field. Decide based on who asked and why. It takes effect from{' '}
          {longDate(item.effectiveFrom)}.
        </p>
      )}
      {item.reason === null ? null : <p className="text-sm">“{item.reason}”</p>}
      {item.awaitingReview === true && (item.findings ?? []).length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {(item.findings ?? []).map((f) => (
            <li key={f.code}>{f.message}</li>
          ))}
        </ul>
      ) : null}

      {flaggedNow && !decided ? <WhyFlagged item={item} /> : null}
      {flaggedNow && decided ? (
        <p className="flex items-center gap-1.5 text-sm text-warning-fg [&_svg]:size-3.5">
          <icons.flagged aria-hidden />
          Flagged when decided: {item.flagSummary ?? flags.map((f) => f.title).join(', ')}
        </p>
      ) : null}
      {decided && item.note ? <p className="text-sm">Note: “{item.note}”</p> : null}

      <Questions item={item} onAnswer={onAnswer} />

      {item.canDecide && !decided ? (
        <Field invalid={needsNote}>
          <FieldLabel>Note</FieldLabel>
          <FieldControl>
            <Textarea
              ref={noteRef}
              value={note}
              maxLength={500}
              rows={2}
              onChange={(e) => {
                setNote(e.target.value);
                if (e.target.value.trim() !== '') setNeedsNote(false);
              }}
            />
          </FieldControl>
          <FieldDescription>
            {flaggedNow
              ? 'Required when you approve something flagged.'
              : 'Optional; kept with the decision.'}
          </FieldDescription>
          <FieldError>Add a note to approve something flagged.</FieldError>
        </Field>
      ) : null}

      {refused === null ? null : (
        <Alert tone="danger" title="Not done">
          {refused}
        </Alert>
      )}

      {decided ? null : (
        // One row at a desk, Not unusual apart; under a finger, a pinned two-column footer (MA7).
        <div
          {...PINNED_BAR}
          className="flex flex-wrap items-center justify-end gap-2 touch:sticky touch:bottom-24 touch:z-10 touch:grid touch:grid-cols-2 touch:bg-surface touch:py-2"
        >
          {item.canMark === true && onMarkNotUnusual !== undefined ? (
            <Button
              variant="ghost"
              className="me-auto touch:me-0"
              startIcon={<icons.reject aria-hidden />}
              loading={busy === 'mark'}
              loadingLabel="Saving"
              onClick={() => {
                setBusy('mark');
                setRefused(null);
                void onMarkNotUnusual(item.id).then((outcome) => {
                  setBusy(null);
                  if (!outcome.ok) setRefused(outcome.message);
                });
              }}
            >
              Not unusual
            </Button>
          ) : null}
          {item.awaitingReview === true ? (
            <span className="me-auto text-sm text-fg-muted touch:col-span-2">
              Review this ID under Identifier reviews first.
            </span>
          ) : null}
            {item.canAsk === true && onAsk !== undefined ? (
              <Button
                startIcon={<icons.message aria-hidden />}
                onClick={() => {
                  setAsking(true);
                }}
              >
                Ask {requester}
              </Button>
            ) : null}
            {item.canSelfApprove === true &&
            item.awaitingReview !== true &&
            onSelfApprove !== undefined ? (
              <ApproveAlone
                label={`${item.name}'s ${item.label}`}
                onApprove={() => onSelfApprove(item.id, note.trim() === '' ? null : note.trim())}
              />
            ) : null}
            {item.canDecide ? (
              <>
                <Button
                  aria-label={`Reject the change to ${item.name}'s ${item.label}`}
                  shortcut="row.decline"
                  loading={busy === 'reject'}
                  loadingLabel="Rejecting"
                  onClick={() => {
                    decide(false);
                  }}
                >
                  Reject
                </Button>
                {item.awaitingReview === true ? null : (
                  <Button
                    variant="primary"
                    startIcon={<icons.confirm aria-hidden />}
                    aria-label={`Approve the change to ${item.name}'s ${item.label}${flaggedNow ? ' with note' : ''}`}
                    shortcut="row.approve"
                    loading={busy === 'approve'}
                    loadingLabel="Approving"
                    onClick={() => {
                      decide(true);
                    }}
                  >
                    {flaggedNow ? 'Approve with note' : 'Approve'}
                  </Button>
                )}
              </>
            ) : null}
            {item.mine ? (
              <Button
                aria-label={`Withdraw the change to ${item.name}'s ${item.label}`}
                onClick={onWithdraw}
              >
                Withdraw
              </Button>
            ) : null}
          {!item.canDecide && !item.mine ? (
            <span className="text-sm text-fg-muted touch:col-span-2">
              This change is about you, so someone else decides.
            </span>
          ) : null}
          {!item.canDecide && item.mine && isHr && item.canSelfApprove !== true ? (
            <span className="text-sm text-fg-muted touch:col-span-2">
              Another HR member must approve your change.
            </span>
          ) : null}
        </div>
      )}
      {asking && onAsk !== undefined ? (
        <Ask
          item={item}
          to={requester}
          onAsk={onAsk}
          onClose={() => {
            setAsking(false);
          }}
        />
      ) : null}
    </Card>
  );
}

/** "Why this is flagged" (AI7): the reasons, the numbers compared, and that it might be fine. */
function WhyFlagged({ item }: { readonly item: ApprovalItem }): JSX.Element {
  const comparisons = item.comparisons ?? [];
  return (
    <AssistantCard
      title="Why this is flagged"
      action={
        <Badge tone="assistant" size="sm">
          AI
        </Badge>
      }
      note="Flags never approve or reject anything. They only ask you to look twice."
    >
      <IconList>
        {flagsOf(item).map((f) => (
          <IconListItem key={f.code} icon={iconOf(f.code)} tone="warning" description={f.detail}>
            {f.title}
          </IconListItem>
        ))}
      </IconList>
      {comparisons.length === 0 ? null : (
        <Card variant="fill" padded>
          <HorizontalBarChart
            label="This change against the raises it was compared with"
            sorted={false}
            showValues
            data={comparisons.map((c) => ({ label: c.label, value: Number(c.percent) }))}
            format={(value) => `${String(value)}%`}
            toneOf={(point) =>
              comparisons.find((c) => c.label === point.label)?.highlight === true
                ? 'warning'
                : 'neutral'
            }
          />
        </Card>
      )}
      {item.flagNote ? <p className="text-sm text-fg-muted">{item.flagNote}</p> : null}
    </AssistantCard>
  );
}

/** Questions about the change, and the requester's answer box. */
function Questions({
  item,
  onAnswer,
}: {
  readonly item: ApprovalItem;
  readonly onAnswer: ApprovalsProps['onAnswer'];
}): JSX.Element | null {
  const questions = item.questions ?? [];
  if (questions.length === 0) return null;
  return (
    <PageSection title="Questions" className="[&_h2]:text-base">
      <IconList divided>
        {questions.map((q) => (
          <IconListItem
            key={q.id}
            icon={<icons.message aria-hidden />}
            tone="info"
            description={
              q.answer === null
                ? q.canAnswer
                  ? null
                  : 'Not answered yet.'
                : `${item.requestedBy === 'You' ? 'You' : item.requestedBy}: “${q.answer}”`
            }
          >
            {q.askedBy} asked: “{q.question}”
            {q.canAnswer && onAnswer !== undefined ? (
              <Answer questionId={q.id} onAnswer={onAnswer} />
            ) : null}
          </IconListItem>
        ))}
      </IconList>
    </PageSection>
  );
}

function Answer({
  questionId,
  onAnswer,
}: {
  readonly questionId: string;
  readonly onAnswer: NonNullable<ApprovalsProps['onAnswer']>;
}): JSX.Element {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <span className="mt-2 flex flex-col gap-2 font-normal">
      <Field invalid={refused !== null}>
        <FieldLabel>Your answer</FieldLabel>
        <FieldControl>
          <Textarea
            value={answer}
            maxLength={500}
            rows={2}
            onChange={(e) => {
              setAnswer(e.target.value);
            }}
          />
        </FieldControl>
        <FieldError>{refused}</FieldError>
      </Field>
      <span>
        <Button
          size="sm"
          variant="primary"
          disabled={answer.trim() === ''}
          loading={busy}
          loadingLabel="Sending"
          onClick={() => {
            setBusy(true);
            setRefused(null);
            void onAnswer(questionId, answer.trim()).then((outcome) => {
              setBusy(false);
              if (!outcome.ok) setRefused(outcome.message);
            });
          }}
        >
          Send answer
        </Button>
      </span>
    </span>
  );
}

/** "Ask Nora": a question to the requester, kept with the change. */
function Ask({
  item,
  to,
  onAsk,
  onClose,
}: {
  readonly item: ApprovalItem;
  readonly to: string;
  readonly onAsk: NonNullable<ApprovalsProps['onAsk']>;
  readonly onClose: () => void;
}): JSX.Element {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask {to} about this change</DialogTitle>
          <DialogDescription>
            {to === 'the requester' ? 'They see' : `${to} sees`} your question on {item.name}’s{' '}
            {item.label.toLowerCase()} change, and answers there. Nothing is decided meanwhile.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field invalid={refused !== null}>
            <FieldLabel>Question</FieldLabel>
            <FieldControl>
              <Textarea
                value={question}
                maxLength={500}
                rows={3}
                onChange={(e) => {
                  setQuestion(e.target.value);
                }}
              />
            </FieldControl>
            <FieldError>{refused}</FieldError>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            startIcon={<icons.send aria-hidden />}
            disabled={question.trim() === ''}
            loading={busy}
            loadingLabel="Sending"
            onClick={() => {
              setBusy(true);
              setRefused(null);
              void onAsk(item.id, question.trim()).then((outcome) => {
                setBusy(false);
                if (outcome.ok) onClose();
                else setRefused(outcome.message);
              });
            }}
          >
            Send question
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What gets flagged (AI8): every check, switchable by a People administrator,
 * the last 90 days, and what the checks never do.
 */
function Checks({
  checks,
  canTune,
  last90,
  onSetCheck,
}: {
  readonly checks: readonly ApprovalCheck[];
  readonly canTune: boolean;
  readonly last90: ApprovalsState['last90'];
  readonly onSetCheck: ApprovalsProps['onSetCheck'];
}): JSX.Element | null {
  const [saving, setSaving] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  if (checks.length === 0) return null;
  const tunable = canTune && onSetCheck !== undefined;
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <PageSection
        surface
        title="What Kithena checks"
        description={tunable ? undefined : 'A People administrator switches these.'}
        actions={
          <Badge tone="assistant" size="sm">
            AI
          </Badge>
        }
      >
        <List aria-label="Checks">
          {checks.map((c) => (
            <ListItem
              key={c.code}
              icon={iconOf(c.code)}
              description={c.detail}
              trailing={
                <Switch
                  checked={c.on}
                  disabled={!tunable}
                  loading={saving === c.code}
                  aria-label={c.title}
                  onCheckedChange={(on) => {
                    if (!tunable) return;
                    setSaving(c.code);
                    setRefused(null);
                    void onSetCheck(c.code, on).then((outcome) => {
                      setSaving(null);
                      if (!outcome.ok) setRefused(outcome.message);
                    });
                  }}
                />
              }
            >
              {c.title}
            </ListItem>
          ))}
        </List>
        {refused === null ? null : (
          <Alert tone="danger" title="Not switched" className="mt-3">
            {refused}
          </Alert>
        )}
      </PageSection>
      <Stack gap={4}>
        {last90 === null || last90 === undefined ? null : (
          <PageSection surface title="The last 90 days">
            <div className="grid grid-cols-3 gap-2.5">
              <Stat label="Flagged" value={last90.flagged} />
              <Stat label="Rejected" value={last90.rejected} />
              <Stat label="Marked not unusual" value={last90.marked} />
            </div>
            <p className="mt-3 text-sm text-fg-muted">
              When you mark a flag as not unusual, similar changes are flagged less often. Each
              person’s marks only affect their own company.
            </p>
          </PageSection>
        )}
        <Alert tone="info" icon={<icons.permission aria-hidden />} title="What it never does">
          It never blocks a change, never contacts anyone, and never uses health, diversity or other
          special-category data.
        </Alert>
      </Stack>
    </div>
  );
}
