import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  List,
  ListDetail,
  ListItem,
  PageHeader,
  Skeleton,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { Decision, DecisionSkeleton, type DecisionData } from './decision';
import { SuggestDates } from './suggest';
import {
  clearLine,
  dayCount,
  lookCloserLine,
  lookOf,
  sentLabel,
  spanLabel,
  type LeaveTypeLook,
  type LookCloser,
  type RequestItem,
} from './words';

/**
 * Requests, for an approver (T16–T18, MT15, MT16): what waits for them,
 * what is coming up, what they decided, and one request at a time.
 *
 * Waiting for me is split as the domain splits it (§9.2): Clear to approve,
 * which Approve all covers and nothing else, and Look closer, each row with
 * its one line. A row opens the request beside the list
 * (`/time-off/approvals/waiting/:id`), and suggesting other dates is a
 * dialog over it at `…/suggest`, so each is an address of its own.
 *
 * One component at two widths: under 40rem of its own width the list is
 * MT15's, one tap per clear row and the rest open one at a time, and a
 * request replaces the list (MT16) with Back to it.
 */

export type ApprovalsTab = 'waiting' | 'coming_up' | 'decided';

export interface ApprovalsData {
  readonly tab: ApprovalsTab;
  readonly clear: readonly RequestItem[];
  readonly lookCloser: readonly { readonly item: RequestItem; readonly reason: LookCloser }[];
  /** Coming up and Decided. */
  readonly items: readonly RequestItem[];
  /** How each leave type looks. */
  readonly types: readonly LeaveTypeLook[];
  /** When the server asked, ISO. */
  readonly now: string;
  /** The request open beside the list, with its team around the dates. */
  readonly decision: DecisionData | null;
}

export interface ApprovalsProps {
  readonly load: Loadable<ApprovalsData>;
  /** The address it is drawn at, for which request is open and whether to suggest. */
  readonly path?: string;
  /** Approve several; Time Off approves only the clear ones and says why not for the rest. */
  readonly onApprove?: (requestIds: readonly string[]) => Promise<Outcome>;
  readonly onDecide?: (requestId: string, decision: 'approve' | 'decline') => Promise<Outcome>;
  readonly onSuggest?: (
    requestId: string,
    proposals: readonly { readonly spans: readonly { from: string; to: string }[] }[],
  ) => Promise<Outcome>;
  /** Go to an address of this screen; a plain link does the same. */
  readonly onNavigate?: (href: string) => void;
}

const WAITING = '/time-off/approvals/waiting';

/** Which request is open, and whether to suggest dates for it, from the address. */
export function openedAt(path: string | undefined): {
  readonly id: string | null;
  readonly suggesting: boolean;
} {
  const match = /^\/time-off\/approvals\/waiting\/([^/]+)(\/suggest)?$/.exec(path ?? '');
  return { id: match?.[1] ?? null, suggesting: match?.[2] !== undefined };
}

const tabOf = (path: string | undefined): ApprovalsTab =>
  path?.startsWith('/time-off/approvals/coming-up') === true
    ? 'coming_up'
    : path?.startsWith('/time-off/approvals/decided') === true
      ? 'decided'
      : 'waiting';

const DESCRIPTION = 'Time off waiting for you, coming up and decided.';

export function Approvals({
  load,
  path,
  onApprove,
  onDecide,
  onSuggest,
  onNavigate,
}: ApprovalsProps): JSX.Element {
  const { id } = openedAt(path);
  if (load.status === 'loading')
    return <ApprovalsSkeleton tab={tabOf(path)} opened={id !== null} />;
  return (
    <div className="@container/approvals flex flex-col gap-6">
      <PageHeader title="Requests" description={DESCRIPTION} />
      <Loaded load={load} what="requests">
        {(data) =>
          data.tab !== 'waiting' ? (
            <Decided data={data} />
          ) : id === null ? (
            <Waiting data={data} onApprove={onApprove} onDecide={onDecide} />
          ) : (
            <Opened
              data={data}
              path={path}
              onDecide={onDecide}
              onSuggest={onSuggest}
              onNavigate={onNavigate}
            />
          )
        }
      </Loaded>
    </div>
  );
}

/* ------------------------------------------------------------ waiting -- */

/** Under 40rem of the screen's width: MT15's rows, no checkboxes, no buttons. */
const deskOnly = '@max-[40rem]/approvals:hidden';
/** The title's link stretched over its row, where the row holds nothing else to press. */
const rowLink = '@max-[40rem]/approvals:before:absolute @max-[40rem]/approvals:before:inset-0';

function Waiting({
  data,
  onApprove,
  onDecide,
}: {
  readonly data: ApprovalsData;
  readonly onApprove: ApprovalsProps['onApprove'];
  readonly onDecide: ApprovalsProps['onDecide'];
}): JSX.Element {
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const run = (action: () => Promise<Outcome>): void => {
    setFailed(null);
    start(async () => {
      const outcome = await action();
      if (!outcome.ok) setFailed(outcome.message);
    });
  };
  const chosen = data.clear.filter((item) => !unchecked.has(item.requestId));
  if (data.clear.length === 0 && data.lookCloser.length === 0) {
    return (
      <Card padded className="text-center">
        <p className="text-md font-semibold">Nothing is waiting for you</p>
        <p className="mt-1 text-sm text-fg-muted">
          New requests from your team come here, sorted into what is clear and what needs a look.
        </p>
      </Card>
    );
  }
  const row = (item: RequestItem, line: string, clear: boolean): JSX.Element => {
    const look = lookOf(data.types, item.leaveTypeKey);
    const who = item.displayName;
    return (
      <ListItem
        key={item.requestId}
        className="relative"
        leading={
          <span className="flex items-center gap-3">
            {clear ? (
              <Checkbox
                className={deskOnly}
                checked={!unchecked.has(item.requestId)}
                aria-label={`Include ${who}’s request in Approve all`}
                onCheckedChange={(on) => {
                  setUnchecked((was) => {
                    const next = new Set(was);
                    if (on === true) next.delete(item.requestId);
                    else next.add(item.requestId);
                    return next;
                  });
                }}
              />
            ) : null}
            <Avatar name={who} />
          </span>
        }
        description={`${look.name} · ${spanLabel(item.span.from, item.span.to)} · ${dayCount(item.workingDays)}`}
        supporting={
          <span className="inline-flex items-start gap-1.5">
            {clear ? (
              <icons.success aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success-fg" />
            ) : (
              <icons.warning aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning-fg" />
            )}
            <span>{line}</span>
          </span>
        }
        meta={<span className={deskOnly}>{sentLabel(item.requestedAt, data.now)}</span>}
        trailing={
          <span className={`flex gap-1.5 ${deskOnly}`}>
            <Button
              size="xs"
              aria-label={`Decline ${who}’s request`}
              startIcon={<icons.close aria-hidden />}
              disabled={onDecide === undefined || pending}
              onClick={() => {
                if (onDecide !== undefined) run(() => onDecide(item.requestId, 'decline'));
              }}
            />
            <Button
              size="xs"
              variant="primary"
              aria-label={`Approve ${who}’s request`}
              startIcon={<icons.confirm aria-hidden />}
              disabled={onDecide === undefined || pending}
              onClick={() => {
                if (onDecide !== undefined) run(() => onDecide(item.requestId, 'approve'));
              }}
            />
          </span>
        }
      >
        {/* Under a thumb the row has no buttons, and the whole of it opens the request (MT15). */}
        <a href={`${WAITING}/${item.requestId}`} className={rowLink}>
          {who}
        </a>
      </ListItem>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      {failed === null ? null : (
        <Alert tone="danger" title="Nothing changed">
          {failed}
        </Alert>
      )}
      {data.clear.length === 0 ? null : (
        <section aria-labelledby="clear-heading" className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2 px-1">
            <h2
              id="clear-heading"
              className="flex flex-1 items-center gap-2 text-sm font-semibold text-fg-muted"
            >
              <icons.assistant aria-hidden className="size-3.5 text-accent-fg" />
              Clear to approve
              <span className="text-fg-subtle">{data.clear.length}</span>
            </h2>
            <Button
              size="sm"
              variant="primary"
              startIcon={<icons.approve aria-hidden />}
              disabled={onApprove === undefined || pending || chosen.length === 0}
              loading={pending}
              onClick={() => {
                if (onApprove !== undefined) run(() => onApprove(chosen.map((i) => i.requestId)));
              }}
            >
              {chosen.length === data.clear.length
                ? `Approve all ${String(chosen.length)}`
                : `Approve ${String(chosen.length)}`}
            </Button>
          </div>
          <List>{data.clear.map((item) => row(item, clearLine(item), true))}</List>
        </section>
      )}
      {data.lookCloser.length === 0 ? null : (
        <section aria-labelledby="closer-heading" className="flex flex-col gap-2.5">
          <h2
            id="closer-heading"
            className="flex items-center gap-2 px-1 text-sm font-semibold text-fg-muted"
          >
            <icons.visible aria-hidden className="size-3.5 text-warning-fg" />
            Look closer
            <span className="text-fg-subtle">{data.lookCloser.length}</span>
          </h2>
          <List>
            {data.lookCloser.map(({ item, reason }) =>
              row(item, lookCloserLine(reason, item), false),
            )}
          </List>
        </section>
      )}
      <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
        <icons.info aria-hidden className="size-3.5" />
        Sorted by Kithena using coverage, balances and deadlines. The order never decides for you.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- opened -- */

function Opened({
  data,
  path,
  onDecide,
  onSuggest,
  onNavigate,
}: {
  readonly data: ApprovalsData;
  readonly path: string | undefined;
  readonly onDecide: ApprovalsProps['onDecide'];
  readonly onSuggest: ApprovalsProps['onSuggest'];
  readonly onNavigate: ApprovalsProps['onNavigate'];
}): JSX.Element {
  const { id, suggesting } = openedAt(path);
  const waiting = [
    ...data.lookCloser.map((l) => ({ item: l.item, closer: true })),
    ...data.clear.map((item) => ({ item, closer: false })),
  ];
  const decision = data.decision;
  const here = `${WAITING}/${id ?? ''}`;
  return (
    <>
      <ListDetail
        selected
        onBack={() => onNavigate?.(WAITING)}
        backLabel="Waiting for me"
        listLabel="Waiting for you"
        detailLabel={decision?.request.displayName ?? 'Request'}
        listWidth="23.75rem"
        splitFrom="lg"
        list={
          <List navigable>
            {waiting.map(({ item, closer }) => {
              const look = lookOf(data.types, item.leaveTypeKey);
              const current = item.requestId === id;
              return (
                <ListItem
                  key={item.requestId}
                  asChild
                  selected={current}
                  leading={<Avatar name={item.displayName} />}
                  description={`${look.name} · ${spanLabel(item.span.from, item.span.to)}`}
                  trailing={
                    closer ? (
                      <icons.visible aria-label="Look closer" className="size-4 text-warning-fg" />
                    ) : (
                      <icons.success
                        aria-label="Clear to approve"
                        className="size-4 text-success-fg"
                      />
                    )
                  }
                >
                  <a
                    href={`${WAITING}/${item.requestId}`}
                    aria-current={current ? 'page' : undefined}
                  >
                    {item.displayName}
                  </a>
                </ListItem>
              );
            })}
          </List>
        }
        detail={
          decision === null ? (
            <Alert tone="warning" title="This request is not waiting for you">
              It may have been decided already, or it is not one you decide.
            </Alert>
          ) : (
            <Decision
              data={decision}
              types={data.types}
              now={data.now}
              suggestHref={`${here}/suggest`}
              onDecide={
                onDecide === undefined
                  ? undefined
                  : async (decided) => {
                      const outcome = await onDecide(decision.request.requestId, decided);
                      if (outcome.ok) onNavigate?.(WAITING);
                      return outcome;
                    }
              }
            />
          )
        }
      />
      {decision !== null && suggesting ? (
        <SuggestDates
          data={decision}
          onClose={() => onNavigate?.(here)}
          onSend={
            onSuggest === undefined
              ? undefined
              : async (proposals) => {
                  const outcome = await onSuggest(decision.request.requestId, proposals);
                  if (outcome.ok) onNavigate?.(WAITING);
                  return outcome;
                }
          }
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------- coming up, decided -- */

const STATUS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }
> = {
  approved: { label: 'Approved', tone: 'success' },
  taken: { label: 'Taken', tone: 'neutral' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  pending: { label: 'Waiting', tone: 'warning' },
  counter_proposed: { label: 'New dates suggested', tone: 'info' },
};

function Decided({ data }: { readonly data: ApprovalsData }): JSX.Element {
  if (data.items.length === 0) {
    return (
      <Card padded className="text-center">
        <p className="text-md font-semibold">
          {data.tab === 'coming_up' ? 'Nothing approved is coming up' : 'Nothing decided yet'}
        </p>
      </Card>
    );
  }
  return (
    <List>
      {data.items.map((item) => {
        const look = lookOf(data.types, item.leaveTypeKey);
        const status = STATUS[item.status] ?? { label: item.status, tone: 'neutral' as const };
        return (
          <ListItem
            key={item.requestId}
            asChild
            icon={look.icon}
            iconTone={look.tone}
            description={`${look.name} · ${spanLabel(item.span.from, item.span.to)} · ${dayCount(item.workingDays)}`}
            trailing={
              <Badge size="sm" tone={status.tone} dot>
                {status.label}
              </Badge>
            }
          >
            <a href={`/time-off/requests/${item.requestId}`}>{item.displayName}</a>
          </ListItem>
        );
      })}
    </List>
  );
}

/* ----------------------------------------------------------- skeleton -- */

/** Rows of a list while it loads. */
const rows = (n: number): JSX.Element => (
  <List>
    {Array.from({ length: n }, (_, i) => (
      <ListItem
        key={i}
        leading={<Skeleton className="size-8 rounded-full" />}
        description={<Skeleton className="h-3 w-56" />}
      >
        <Skeleton className="h-3.5 w-36" />
      </ListItem>
    ))}
  </List>
);

/**
 * Requests while they load, in the exact shape of the tab: the two groups
 * of rows, the list beside a request, or one list.
 */
export function ApprovalsSkeleton({
  tab,
  opened,
}: {
  readonly tab: ApprovalsTab;
  readonly opened: boolean;
}): JSX.Element {
  return (
    <div className="@container/approvals flex flex-col gap-6">
      <PageHeader title="Requests" description={DESCRIPTION} />
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">Loading requests</span>
        {tab !== 'waiting' ? (
          rows(5)
        ) : opened ? (
          <DecisionSkeleton />
        ) : (
          <>
            <Skeleton className="h-8 w-48" />
            {rows(3)}
            <Skeleton className="h-5 w-32" />
            {rows(2)}
          </>
        )}
      </div>
    </div>
  );
}
