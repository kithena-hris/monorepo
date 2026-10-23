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
  type Written,
} from './words';
import { t } from '../i18n';

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
  /** The requester's own options: the message to send with them (TOF-088). */
  readonly message: Written | null;
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
  /** What to know's closing line (TOF-087). */
  readonly whatToKnow: Written;
  /** Why the clash matters and what fixing it costs (T15, TOF-088); `null` with nothing to fix. */
  readonly clash: Written | null;
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
          <h2 className="text-lg font-bold">
            {t('approvals.decision.text', '{{displayName}} · {{name}}', {
              displayName: member.displayName,
              name: look.name.toLowerCase(),
            })}
          </h2>
          <p className="text-sm text-fg-muted">
            {t('approvals.decision.decide_by', '{{sentLabel}} · decide by {{due}}', {
              sentLabel: sentLabel(request.requestedAt, now, member.timeZone),
              due: shortDate(due),
            })}
          </p>
        </div>
        <Badge size="lg">
          {t('approvals.decision.text_2', '{{span}} · {{dayCount}}', {
            span,
            dayCount: dayCount(request.workingDays),
          })}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {data.balance === null ? (
          <Stat inset label={look.name} value={dayCount(request.workingDays)} />
        ) : (
          <Stat
            inset
            label={t('approvals.decision.balance', '{{name}} balance', { name: look.name })}
            from={amount(data.balance.before)}
            value={amount(data.balance.after)}
            unit="days"
            {...(Number(data.balance.after) < 0 ? { sentiment: 'negative' as const } : {})}
          />
        )}
        <Stat
          inset
          label={t('approvals.decision.last_time_off', 'Last time off')}
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
            label={t('approvals.decision.around', '{{value}} around {{span}}', {
              value: member.teamName ?? 'The team',
              span,
            })}
            highlight={member.personId}
          />
          <TeamTimeline
            className={phoneOnly}
            view={data.team}
            types={types}
            from={range.phone.from}
            to={range.phone.to}
            label={t('approvals.decision.the_week_of', '{{value}}, the week of {{from}}', {
              value: member.teamName ?? 'The team',
              from: shortDate(range.phone.from),
            })}
            highlight={member.personId}
          />
        </>
      )}

      <WhatToKnow data={data} />

      {swap === undefined || swap.swapped === null || !data.canDecide ? null : (
        <Alert
          tone="info"
          title={t('approvals.decision.suggest_swap', 'Suggest: swap {{swapWords}}', {
            swapWords: swapWords(swap.swapped),
          })}
        >
          {t('approvals.decision.can_accept_in_one_tap', '{{firstName}} can accept in one tap.', {
            firstName: firstName(member.displayName),
          })}
        </Alert>
      )}

      {failed === null ? null : (
        <Alert tone="danger" title={t('approvals.decision.nothing_changed', 'Nothing changed')}>
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
            {t('approvals.decision.decline', 'Decline')}
          </Button>
          <span className="ms-auto flex gap-2">
            <Button asChild startIcon={<icons.calendar aria-hidden />}>
              <a href={suggestHref}>
                {t('approvals.decision.suggest_other_dates', 'Suggest other dates')}
              </a>
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
              {t('approvals.decision.approve', 'Approve')}
            </Button>
          </span>
        </div>
      ) : (
        <Alert
          tone="neutral"
          title={
            request.waitingOn === 'hr'
              ? t('approvals.decision.waiting_on_hr', 'Waiting on HR')
              : t('approvals.decision.not_yours_to_decide', 'Not yours to decide')
          }
        >
          {request.waitingOn === 'hr'
            ? t(
                'approvals.decision.you_approved_your_part_hr_decides',
                'You approved your part. HR decides the rest.',
              )
            : t(
                'approvals.decision.somebody_else_decides_this_request',
                'Somebody else decides this request.',
              )}
        </Alert>
      )}
    </div>
  );
}

/** On a line a model wrote, and only there (§14.1). */
export function AiTag(): JSX.Element {
  return (
    <Badge tone="assistant" size="sm">
      {t('approvals.decision.ai', 'AI')}
    </Badge>
  );
}

/** "Wed 21 for Mon 26". */
export const swapWords = (swapped: NonNullable<Alternative['swapped']>): string =>
  t('approvals.decision.for', '{{listOf}} for {{listOf2}}', {
    listOf: listOf(swapped.out.map(dayName)),
    listOf2: listOf(swapped.in.map(dayName)),
  });

/**
 * What to know (T17's card): the days the team falls short and who is off
 * then, the balance after, the last break, all from the domain's numbers,
 * and Time Off's closing line on why it might be fine (TOF-087), tagged AI
 * only when a model wrote it.
 */
function WhatToKnow({ data }: { readonly data: DecisionData }): JSX.Element {
  const who = firstName(data.member.displayName);
  const offOn = (date: string): string[] =>
    data.othersOff
      .filter((o) => o.span.from <= date && date <= o.span.to)
      .map((o) => firstName(o.displayName));
  const after = data.balance === null ? null : Number(data.balance.after);
  return (
    <AssistantCard
      title={t('approvals.decision.what_to_know', 'What to know')}
      action={data.whatToKnow.ai ? <AiTag /> : undefined}
      note={t(
        'approvals.decision.written_from_the_balance_and_the',
        'Written from the balance and the team calendar. The decision is yours.',
      )}
    >
      <IconList>
        {data.belowMinimum.map((day) => {
          const names = offOn(day.date);
          return (
            <IconListItem
              key={day.date}
              icon={<icons.people />}
              tone="warning"
              description={t(
                'approvals.decision.off_the_team_asks_for',
                '{{value}} off. The team asks for {{required}}.',
                {
                  value:
                    names.length === 0
                      ? 'Others are'
                      : `${listOf(names)} ${names.length === 1 ? 'is' : 'are'}`,
                  required: String(day.required),
                },
              )}
            >
              {t('approvals.decision.of_in', '{{dayName}}: {{in}} of {{of}} in', {
                dayName: dayName(day.date),
                in: String(day.in),
                of: String(day.of),
              })}
            </IconListItem>
          );
        })}
        {data.balance === null || after === null ? null : after < 0 ? (
          <IconListItem
            icon={<icons.warning />}
            tone="warning"
            description={t(
              'approvals.decision.below_zero_needs_hr_after_you',
              'Below zero needs HR after you.',
            )}
          >
            {t('approvals.decision.takes_to_days', 'Takes {{who}} to {{after}} days', {
              who,
              after: amount(data.balance.after),
            })}
          </IconListItem>
        ) : (
          <IconListItem
            icon={<icons.success />}
            tone="success"
            description={t(
              'approvals.decision.days_left_after_this',
              '{{after}} days left after this.{{value}}',
              {
                after: amount(data.balance.after),
                value:
                  data.lastTaken === null
                    ? ''
                    : ` Last time off ${spanLabel(data.lastTaken.from, data.lastTaken.to)}.`,
              },
            )}
          >
            {t('approvals.decision.enough_balance', 'Enough balance')}
          </IconListItem>
        )}
      </IconList>
      <p className="text-sm text-fg-muted">{data.whatToKnow.text}</p>
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
