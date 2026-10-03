import {
  Alert,
  AssistantCard,
  Avatar,
  Badge,
  Button,
  IconList,
  IconListItem,
  Skeleton,
  Stat,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import type { Outcome } from '../load';
import { TeamTimeline } from './timeline';
import {
  addDays,
  amount,
  dayCount,
  dayName,
  firstName,
  listOf,
  lookOf,
  mondayOf,
  sentLabel,
  shortDate,
  spanLabel,
  workingDaysAfter,
  type CalendarView,
  type CoverageDay,
  type LeaveTypeLook,
  type LookCloser,
  type Range,
  type RequestItem,
  type Span,
} from './words';

/**
 * Deciding one request (T17, MT16): everything needed on one screen. The
 * balance before and after, the last time off, the team around the dates
 * with who is in each day, and what to know, ending with why it might be
 * fine (templated until TOF-087). Decline, Suggest other dates or Approve.
 *
 * At a desk the team is shown from four days before to three after; on a
 * phone, the working week the request starts in.
 */

/** One of the domain's ranked fixes for a clash (§9.5, §9.6). */
export interface Alternative {
  readonly kind: 'swap_days' | 'next_clean_week' | 'approve_as_asked' | 'ask_teammate';
  readonly affects: 'requester' | 'nobody' | 'teammate';
  readonly dates: readonly string[];
  readonly spans: readonly Range[];
  readonly coverage: readonly CoverageDay[];
  readonly swapped: { readonly out: readonly string[]; readonly in: readonly string[] } | null;
  readonly teammate: { readonly personId: string; readonly displayName: string } | null;
  readonly absence: Range | null;
}

export interface DecisionData {
  readonly request: RequestItem;
  readonly member: {
    readonly personId: string;
    readonly displayName: string;
    readonly firstName: string;
    readonly teamName: string | null;
    readonly timeZone: string;
  };
  readonly balance: { readonly before: string; readonly after: string } | null;
  readonly belowMinimum: readonly CoverageDay[];
  readonly triage: {
    readonly group: 'clear' | 'look_closer';
    readonly reason: LookCloser | null;
  };
  readonly othersOff: readonly {
    readonly personId: string;
    readonly displayName: string;
    readonly leaveTypeKey: string | null;
    readonly span: Span;
  }[];
  readonly canDecide: boolean;
  readonly lastTaken: Range | null;
  readonly alternatives: readonly Alternative[];
  /** The member's team around the dates, when they are on one. */
  readonly team: CalendarView | null;
}

/** Where the team timeline starts and ends, at a desk and on a phone. */
export function around(span: { readonly from: string; readonly to: string }): {
  readonly desk: Range;
  readonly phone: Range;
} {
  const monday = mondayOf(span.from);
  return {
    desk: { from: addDays(span.from, -4), to: addDays(span.to, 3) },
    phone: { from: monday, to: addDays(monday, 4) },
  };
}

/** Under 40rem of the screen's width. */
const phoneOnly = 'hidden @max-[40rem]/approvals:flex';
const deskOnly = '@max-[40rem]/approvals:hidden';

export function Decision({
  data,
  types,
  now,
  suggestHref,
  onDecide,
}: {
  readonly data: DecisionData;
  readonly types: readonly LeaveTypeLook[];
  readonly now: string;
  readonly suggestHref: string;
  readonly onDecide?: ((decision: 'approve' | 'decline') => Promise<Outcome>) | undefined;
}): JSX.Element {
  const { request, member } = data;
  const look = lookOf(types, request.leaveTypeKey);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const decide = (decision: 'approve' | 'decline'): void => {
    if (onDecide === undefined) return;
    setFailed(null);
    start(async () => {
      const outcome = await onDecide(decision);
      if (!outcome.ok) setFailed(outcome.message);
    });
  };
  const span = spanLabel(request.span.from, request.span.to);
  const range = around(request.span);
  const due = workingDaysAfter(request.requestedAt.slice(0, 10), 3);
  const swap = data.alternatives.find((a) => a.kind === 'swap_days');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={member.displayName} size="xl" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{`${member.displayName} · ${look.name.toLowerCase()}`}</h2>
          <p className="text-sm text-fg-muted">
            {`${sentLabel(request.requestedAt, now, member.timeZone)} · decide by ${shortDate(due)}`}
          </p>
        </div>
        <Badge size="lg">{`${span} · ${dayCount(request.workingDays)}`}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {data.balance === null ? (
          <Stat inset label={look.name} value={dayCount(request.workingDays)} />
        ) : (
          <Stat
            inset
            label={`${look.name} balance`}
            from={amount(data.balance.before)}
            value={amount(data.balance.after)}
            unit="days"
            {...(Number(data.balance.after) < 0 ? { sentiment: 'negative' as const } : {})}
          />
        )}
        <Stat
          inset
          label="Last time off"
          value={
            data.lastTaken === null ? 'None yet' : spanLabel(data.lastTaken.from, data.lastTaken.to)
          }
        />
      </div>

      {data.team === null ? null : (
        <>
          <TeamTimeline
            className={deskOnly}
            view={data.team}
            types={types}
            from={range.desk.from}
            to={range.desk.to}
            label={`${member.teamName ?? 'The team'} around ${span}`}
            highlight={member.personId}
          />
          <TeamTimeline
            className={phoneOnly}
            view={data.team}
            types={types}
            from={range.phone.from}
            to={range.phone.to}
            label={`${member.teamName ?? 'The team'}, the week of ${shortDate(range.phone.from)}`}
            highlight={member.personId}
          />
        </>
      )}

      <WhatToKnow data={data} />

      {swap === undefined || swap.swapped === null || !data.canDecide ? null : (
        <Alert tone="info" title={`Suggest: swap ${swapWords(swap.swapped)}`}>
          {`${firstName(member.displayName)} can accept in one tap.`}
        </Alert>
      )}

      {failed === null ? null : (
        <Alert tone="danger" title="Nothing changed">
          {failed}
        </Alert>
      )}

      {data.canDecide ? (
        <div className="flex items-center gap-2 @max-[40rem]/approvals:sticky @max-[40rem]/approvals:bottom-0 @max-[40rem]/approvals:bg-surface @max-[40rem]/approvals:py-3">
          <Button
            variant="ghost"
            startIcon={<icons.close aria-hidden />}
            disabled={onDecide === undefined || pending}
            onClick={() => {
              decide('decline');
            }}
          >
            Decline
          </Button>
          <span className="ms-auto flex gap-2">
            <Button asChild startIcon={<icons.calendar aria-hidden />}>
              <a href={suggestHref}>Suggest other dates</a>
            </Button>
            <Button
              variant="primary"
              startIcon={<icons.confirm aria-hidden />}
              disabled={onDecide === undefined || pending}
              loading={pending}
              onClick={() => {
                decide('approve');
              }}
            >
              Approve
            </Button>
          </span>
        </div>
      ) : (
        <Alert
          tone="neutral"
          title={request.waitingOn === 'hr' ? 'Waiting on HR' : 'Not yours to decide'}
        >
          {request.waitingOn === 'hr'
            ? 'You approved your part. HR decides the rest.'
            : 'Somebody else decides this request.'}
        </Alert>
      )}
    </div>
  );
}

/** "Wed 21 for Mon 26". */
export const swapWords = (swapped: NonNullable<Alternative['swapped']>): string =>
  `${listOf(swapped.out.map(dayName))} for ${listOf(swapped.in.map(dayName))}`;

/**
 * What to know (T17's card): the days the team falls short and who is off
 * then, the balance after, the last break, and a closing line on why it
 * might be fine. Templated from the domain's numbers until TOF-087.
 */
function WhatToKnow({ data }: { readonly data: DecisionData }): JSX.Element {
  const who = firstName(data.member.displayName);
  const offOn = (date: string): string[] =>
    data.othersOff
      .filter((o) => o.span.from <= date && date <= o.span.to)
      .map((o) => firstName(o.displayName));
  const worst = data.belowMinimum.toSorted((a, b) => a.in - b.in)[0];
  const after = data.balance === null ? null : Number(data.balance.after);
  return (
    <AssistantCard
      title="What to know"
      note="Written from the balance and the team calendar. The decision is yours."
    >
      <IconList>
        {data.belowMinimum.map((day) => {
          const names = offOn(day.date);
          return (
            <IconListItem
              key={day.date}
              icon={<icons.people />}
              tone="warning"
              description={`${names.length === 0 ? 'Others are' : `${listOf(names)} ${names.length === 1 ? 'is' : 'are'}`} off. The team asks for ${String(day.required)}.`}
            >
              {`${dayName(day.date)}: ${String(day.in)} of ${String(day.of)} in`}
            </IconListItem>
          );
        })}
        {data.balance === null || after === null ? null : after < 0 ? (
          <IconListItem
            icon={<icons.warning />}
            tone="warning"
            description="Below zero needs HR after you."
          >
            {`Takes ${who} to ${amount(data.balance.after)} days`}
          </IconListItem>
        ) : (
          <IconListItem
            icon={<icons.success />}
            tone="success"
            description={`${amount(data.balance.after)} days left after this.${data.lastTaken === null ? '' : ` Last time off ${spanLabel(data.lastTaken.from, data.lastTaken.to)}.`}`}
          >
            Enough balance
          </IconListItem>
        )}
      </IconList>
      <p className="text-sm text-fg-muted">
        {worst === undefined
          ? 'This looks fine: the team stays at its minimum and the balance covers it.'
          : `This might be fine if ${String(worst.in)} people can cover on ${dayName(worst.date)}.`}
      </p>
    </AssistantCard>
  );
}

/** One request beside the list while it loads: the list, the header, the stats, the team, the card. */
export function DecisionSkeleton(): JSX.Element {
  return (
    <div className="@container flex flex-col gap-4 @4xl:grid @4xl:grid-cols-[23.75rem_minmax(0,1fr)]">
      <Skeleton className="h-80 rounded-lg @max-4xl:hidden" />
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-3.5 w-44" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    </div>
  );
}
