import {
  Alert,
  Avatar,
  Badge,
  Button,
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
  FieldLabel,
  List,
  ListDetail,
  ListItem,
  PageHeader,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { useHeld } from '../held';
import { Loaded, type Loadable, type Outcome } from '../load';
import { DisplayValue, longDate } from '../record/display';
import type { AttributeValue, PendingValue, RecordField } from '../record/model';
import { ApproveAlone, PendingBadge } from '../record/pending';

/**
 * The approvals inbox (PEO-077; PRD §8.6).
 *
 * A change to a sensitive field — a bank account, a salary, whatever the
 * tenant switched on — is held, not applied, until somebody other than the
 * requester and the person it is about approves it. HR sees every change
 * waiting here, oldest first, with the value asked for beside the value in
 * force; anybody else sees their own, and may withdraw one. Undecided after
 * seven days, a change lapses. An approval applies the value from the date
 * it was asked for.
 *
 * Two exceptions, both People's rules shown here. When no other HR member may
 * approve a change — the requester is the only one, or the only other is its
 * subject — the requester approves it alone, after a dialog that says so. And a
 * national identifier our checks doubt is reviewed before it is approved: it
 * reads *Awaiting identifier review*, with what the checks found, and offers
 * no approval until HR accepts it under Identifiers to review.
 */

export interface ApprovalItem extends PendingValue {
  readonly personId: string;
  readonly name: string;
  /** False where the viewer may not read the field: they decide on who, when and why. */
  readonly readable: boolean;
  /** What is in force now, masked as the field is. */
  readonly current: AttributeValue;
  /**
   * What People's rules found unusual about it, each with its reason: only for
   * whoever decides it. A flag informs; it never stops a decision.
   */
  readonly flags?: readonly ApprovalFlag[];
}

export interface ApprovalFlag {
  readonly code: string;
  readonly reason: string;
}

const flagCount = (n: number): string => `${String(n)} ${n === 1 ? 'flag' : 'flags'}`;

export interface ApprovalsState {
  readonly isHr: boolean;
  readonly items: readonly ApprovalItem[];
}

export interface ApprovalsProps {
  readonly load: Loadable<ApprovalsState>;
  readonly onDecide: (changeId: string, approve: boolean, note: string | null) => Promise<Outcome>;
  readonly onWithdraw: (changeId: string) => Promise<Outcome>;
  /** A requester no other HR member can approve for, approving their own change, once they confirm (PEO-077). */
  readonly onSelfApprove?: (changeId: string) => Promise<Outcome>;
  readonly onOpen?: (personId: string) => void;
  /** HR's list: waiting for them, or what they asked (`?tab=asked`). Absent: whichever has something. */
  readonly tab?: ApprovalsTab;
  readonly onTabChange?: (tab: ApprovalsTab) => void;
}

export type ApprovalsTab = 'mine' | 'asked';

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

export function Approvals({ load, ...props }: ApprovalsProps): JSX.Element {
  return (
    <Loaded load={load} what="changes waiting for approval">
      {(state) => <Inbox state={state} {...props} />}
    </Loaded>
  );
}

/** How long until it lapses, in days: "2 days left". */
function daysLeft(expiresAt: string, now: number): string {
  const days = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 86_400_000));
  return days === 0 ? 'Expires today' : `${String(days)} ${days === 1 ? 'day' : 'days'} left`;
}

function Inbox({
  state,
  onDecide,
  onWithdraw,
  onSelfApprove,
  onOpen,
  tab: heldTab,
  onTabChange,
}: Omit<ApprovalsProps, 'load'> & { readonly state: ApprovalsState }): JSX.Element {
  const [deciding, setDeciding] = useState<{ item: ApprovalItem; approve: boolean } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const forMe = state.items.filter((i) => i.canDecide || i.canSelfApprove === true);
  const asked = state.items.filter((i) => i.mine && !forMe.includes(i));
  const rest = state.items.filter((i) => !forMe.includes(i) && !asked.includes(i));
  const [tab, setTab] = useHeld<ApprovalsTab>(
    heldTab,
    onTabChange,
    forMe.length > 0 || !state.isHr ? 'mine' : 'asked',
  );
  const shown = state.isHr ? (tab === 'mine' ? [...forMe, ...rest] : asked) : state.items;
  const [picked, setPicked] = useState<string | null>(shown[0]?.id ?? null);
  const current = shown.find((i) => i.id === picked) ?? shown[0] ?? null;
  const [now] = useState(() => Date.now());

  const list = (
    // J and K through the changes; A approves the focused one and R declines
    // it, each through the same confirmation a click opens.
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
                          label: 'Approve',
                          shortcut: 'row.approve',
                          onSelect: () => {
                            setPicked(item.id);
                            setDeciding({ item, approve: true });
                          },
                        },
                      ]),
                  {
                    id: 'decline',
                    label: 'Reject',
                    shortcut: 'row.decline',
                    onSelect: () => {
                      setPicked(item.id);
                      setDeciding({ item, approve: false });
                    },
                  },
                ],
              }
            : {})}
          leading={<Avatar size="lg" name={item.name} />}
          description={`${item.label} · from ${longDate(item.effectiveFrom)}`}
          meta={daysLeft(item.expiresAt, now)}
          {...((item.flags ?? []).length > 0
            ? {
                trailing: (
                  <Badge size="xs" tone="warning">
                    {flagCount((item.flags ?? []).length)}
                  </Badge>
                ),
              }
            : {})}
        >
          <button
            type="button"
            aria-current={item.id === current?.id ? true : undefined}
            onClick={() => {
              setPicked(item.id);
            }}
          >
            {item.name}
          </button>
        </ListItem>
      ))}
    </List>
  );

  const detail =
    current === null ? null : (
      <Detail
        item={current}
        isHr={state.isHr}
        now={now}
        onDecide={(approve) => {
          setDeciding({ item: current, approve });
        }}
        onWithdraw={() => {
          setRefused(null);
          void onWithdraw(current.id).then((outcome) => {
            if (!outcome.ok) setRefused(outcome.message);
          });
        }}
        onSelfApprove={onSelfApprove}
        onOpen={onOpen}
      />
    );

  return (
    <Stack gap={5}>
      <PageHeader
        title={state.isHr ? 'Approvals' : 'Your pending changes'}
        description={
          state.isHr
            ? 'Changes to sensitive fields wait here until someone other than the requester decides. Undecided changes expire after 7 days.'
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
            if (next === 'mine' || next === 'asked') setTab(next);
            setPicked(null);
          }}
        >
          <TabsList aria-label="Whose changes">
            <TabsTrigger value="mine">
              Waiting for me{' '}
              <Badge size="xs" variant="solid" tone="danger">
                {forMe.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="asked">
              I asked <Badge size="xs">{asked.length}</Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="pt-4">
            {shown.length === 0 ? (
              <EmptyState title="Nothing to approve" description="All changes have been decided." />
            ) : (
              <ListDetail
                listWidth="26rem"
                listLabel="Changes"
                detailLabel={current === null ? 'Change' : `${current.name}’s ${current.label}`}
                selected={picked !== null}
                onBack={() => {
                  setPicked(null);
                }}
                backLabel="All changes"
                list={list}
                detail={detail}
              />
            )}
          </TabsContent>
        </Tabs>
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing waiting" description="None of your changes wait for approval." />
      ) : (
        <ListDetail
          listWidth="26rem"
          listLabel="Changes"
          detailLabel={current === null ? 'Change' : `${current.name}’s ${current.label}`}
          selected={picked !== null}
          onBack={() => {
            setPicked(null);
          }}
          backLabel="All changes"
          list={list}
          detail={detail}
        />
      )}
      {deciding === null ? null : (
        <Decide
          item={deciding.item}
          approve={deciding.approve}
          onDecide={onDecide}
          onClose={() => {
            setDeciding(null);
          }}
        />
      )}
    </Stack>
  );
}

/**
 * One change, to decide (W13, M10): who asked, the value in force struck
 * through beside the one asked for, why it needs a second person, and the
 * decision. Approve and Reject open the same short confirmation, with a note.
 */
function Detail({
  item,
  isHr,
  now,
  onDecide,
  onWithdraw,
  onSelfApprove,
  onOpen,
}: {
  readonly item: ApprovalItem;
  readonly isHr: boolean;
  readonly now: number;
  readonly onDecide: (approve: boolean) => void;
  readonly onWithdraw: () => void;
  readonly onSelfApprove: ApprovalsProps['onSelfApprove'];
  readonly onOpen: ApprovalsProps['onOpen'];
}): JSX.Element {
  const field = asField(item);
  return (
    // Not a landmark of its own: the list-detail's pane is the region, named for it.
    <div className="flex flex-col gap-4 rounded-lg bg-surface p-5 shadow-sm touch:rounded-[1.375rem] touch:p-4">
      <div className="flex items-start gap-3.5">
        <Avatar size="xl" name={item.name} />
        <div className="min-w-0 flex-1">
          <h2 className="text-md font-bold">
            {onOpen === undefined ? (
              item.name
            ) : (
              <button
                type="button"
                className="rounded-xs underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-border-focus"
                onClick={() => {
                  onOpen(item.personId);
                }}
              >
                {item.name}
              </button>
            )}
            <span className="font-normal text-fg-muted"> · {item.label}</span>
          </h2>
          <p className="text-sm text-fg-muted">
            Asked by {item.requestedBy} on {longDate(item.requestedAt.slice(0, 10))} ·{' '}
            {daysLeft(item.expiresAt, now).toLowerCase()} if nobody decides
          </p>
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="sensitive" size="sm">
              Needs approval
            </Badge>
            <PendingBadge pending={item} />
          </span>
        </div>
      </div>
      {/* First, so a decider reads them before the diff and the buttons. */}
      {(item.flags ?? []).length === 0 ? null : (
        <Alert tone="warning" title="Worth a second look" icon={<icons.flagged aria-hidden />}>
          <ul className="flex list-disc flex-col gap-1 ps-4">
            {(item.flags ?? []).map((f) => (
              <li key={f.code}>{f.reason}</li>
            ))}
          </ul>
          <p className="mt-2 text-fg-muted">
            People’s checks found this. It doesn’t stop you approving or rejecting.
          </p>
        </Alert>
      )}
      {item.readable ? (
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
      {isHr && item.canDecide ? (
        <Alert tone="info" title="Why this needs you">
          {item.label} is sensitive, so a second person checks every change. You can’t approve a
          change you asked for.
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2 touch:sticky touch:bottom-24 touch:grid touch:grid-cols-2">
        {item.awaitingReview === true ? (
          <span className="me-auto text-sm text-fg-muted">
            Review this ID under Identifier reviews first.
          </span>
        ) : null}
        {item.canSelfApprove === true &&
        item.awaitingReview !== true &&
        onSelfApprove !== undefined ? (
          <ApproveAlone
            label={`${item.name}'s ${item.label}`}
            onApprove={() => onSelfApprove(item.id)}
          />
        ) : null}
        {item.canDecide ? (
          <>
            <Button
              aria-label={`Reject the change to ${item.name}'s ${item.label}`}
              shortcut="row.decline"
              onClick={() => {
                onDecide(false);
              }}
            >
              Reject
            </Button>
            {item.awaitingReview === true ? null : (
              <Button
                variant="primary"
                startIcon={<icons.confirm aria-hidden />}
                aria-label={`Approve the change to ${item.name}'s ${item.label}`}
                shortcut="row.approve"
                onClick={() => {
                  onDecide(true);
                }}
              >
                Approve
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
          <span className="text-sm text-fg-muted">
            This change is about you, so someone else decides.
          </span>
        ) : null}
        {!item.canDecide && item.mine && isHr && item.canSelfApprove !== true ? (
          <span className="text-sm text-fg-muted">Another HR member must approve your change.</span>
        ) : null}
      </div>
    </div>
  );
}

function Decide({
  item,
  approve,
  onDecide,
  onClose,
}: {
  readonly item: ApprovalItem;
  readonly approve: boolean;
  readonly onDecide: ApprovalsProps['onDecide'];
  readonly onClose: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const verb = approve ? 'Approve' : 'Reject';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {verb} the change to {item.name}'s {item.label}
          </DialogTitle>
          <DialogDescription>
            {approve
              ? `It takes effect from ${longDate(item.effectiveFrom)}, as asked. This is final.`
              : 'It is not applied, and the record keeps what it has. This is final.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={4}>
            <Field>
              <FieldLabel>Note</FieldLabel>
              <FieldControl>
                <Textarea
                  value={note}
                  maxLength={500}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                />
              </FieldControl>
              <FieldDescription>Optional; kept with the decision.</FieldDescription>
            </Field>
            {refused === null ? null : (
              <Alert tone="danger" title="Not decided">
                {refused}
              </Alert>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel="Saving"
            onClick={() => {
              setBusy(true);
              setRefused(null);
              void onDecide(item.id, approve, note.trim() === '' ? null : note.trim()).then(
                (outcome) => {
                  setBusy(false);
                  if (outcome.ok) onClose();
                  else setRefused(outcome.message);
                },
              );
            }}
          >
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
