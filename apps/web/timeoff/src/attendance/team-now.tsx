import {
  Avatar,
  Badge,
  Button,
  List,
  ListItem,
  PageHeader,
  PageSection,
  Skeleton,
  Stat,
  icons,
  type IconName,
} from '@reach/ui';
import { createElement, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable } from '../load';
import { DayBar } from './day-bar';
import {
  WHERE,
  addDays,
  duration,
  shortDate,
  weekdayName,
  type ClockState,
  type Day,
  type WorkModel,
} from './time';

/**
 * Team, right now (T22, MT19, PRD §11.6): a calm live board of the people who
 * report to you. In, on a break, not in yet, away; for each, office or
 * remote and today's bar. No location trail and no screen tracking: only the
 * punches people make. "Needs you" lists corrections made late and overtime
 * waiting for a decision.
 *
 * Drawn from the shell's read of the board and of today's team calendar, for
 * who is away and until when. One component at two widths: under 40rem of
 * its own width it is MT19's counts and one row each, the bar left out.
 */

export interface TeamNowData {
  readonly people: readonly {
    readonly personId: string;
    readonly displayName: string;
    readonly state: ClockState;
    readonly workModel: WorkModel | null;
    readonly today: Day;
  }[];
  readonly needsYou: readonly {
    readonly kind: 'correction' | 'overtime';
    readonly personId: string;
    readonly displayName: string;
    readonly date: string;
    readonly minutes: number | null;
    readonly punch: { readonly kind: string } | null;
  }[];
  /** Today's calendar entries for the team: who is away, and until when. */
  readonly away: readonly {
    readonly personId: string;
    readonly status: string;
    readonly span: { readonly from: string; readonly to: string };
  }[];
  readonly now: string;
}

export interface TeamNowProps {
  readonly load: Loadable<TeamNowData>;
}

export function TeamNow({ load }: TeamNowProps): JSX.Element {
  if (load.status === 'loading') return <TeamNowSkeleton />;
  return (
    <div className="@container/now flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Attendance" /> : null}
      <Loaded load={load} what="your team right now">
        {(data) => <Ready data={data} />}
      </Loaded>
    </div>
  );
}

const body =
  'flex flex-col gap-5 @min-[60rem]/now:grid @min-[60rem]/now:grid-cols-[minmax(0,1fr)_20rem] @min-[60rem]/now:items-start';
const counts = 'grid grid-cols-4 gap-3 @max-[40rem]/now:grid-cols-2';

type Now = 'in' | 'break' | 'waiting' | 'away' | 'done';

const NOW: Record<Now, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  in: { label: 'In', tone: 'success' },
  break: { label: 'On a break', tone: 'warning' },
  waiting: { label: 'Not in yet', tone: 'neutral' },
  away: { label: 'Away', tone: 'neutral' },
  done: { label: 'Clocked out', tone: 'neutral' },
};

const WHERE_ICON: Record<WorkModel, IconName> = {
  office: 'company',
  remote: 'home',
  client: 'organisation',
};

const icon = (name: IconName): ReactNode => createElement(icons[name], { 'aria-hidden': true });

/** The weekday after `date`. ponytail: Monday to Friday, until the member's own pattern crosses. */
function nextWorkingDay(date: string): string {
  let next = addDays(date, 1);
  while ([0, 6].includes(new Date(`${next}T00:00:00Z`).getUTCDay())) next = addDays(next, 1);
  return next;
}

function Ready({ data }: { readonly data: TeamNowData }): JSX.Element {
  const away = new Map(
    data.away
      .filter((a) => a.status === 'approved' || a.status === 'taken')
      .map((a) => [a.personId, a.span.to]),
  );
  // The board's minute: where the running bars end, each already in its own day's minutes.
  const live = data.people.flatMap((p) =>
    p.today.segments.filter((s) => s.kind === 'live' || s.kind === 'break').map((s) => s.to),
  );
  const minute = live.length === 0 ? undefined : Math.max(...live);
  const rows = data.people.map((p) => {
    const now: Now = away.has(p.personId)
      ? 'away'
      : p.state === 'in'
        ? 'in'
        : p.state === 'on_break'
          ? 'break'
          : p.today.status === 'complete'
            ? 'done'
            : 'waiting';
    const lastBreak = p.today.segments.findLast((s) => s.kind === 'break');
    const badge =
      now === 'in'
        ? `In · ${duration(p.today.workedMinutes ?? 0)}`
        : now === 'break'
          ? `Break · ${duration(lastBreak === undefined ? 0 : lastBreak.to - lastBreak.from)}`
          : NOW[now].label;
    const back = away.get(p.personId);
    return { ...p, now, badge, back };
  });
  const tally = (now: Now): number => rows.filter((r) => r.now === now).length;

  return (
    <>
      <PageHeader
        title="Attendance"
        description={`${String(data.people.length)} ${data.people.length === 1 ? 'person reports' : 'people report'} to you`}
      />
      <div className={body}>
        <div className="flex min-w-0 flex-col gap-5">
          <div className={counts}>
            {(['in', 'break', 'waiting', 'away'] as const).map((n) => (
              <Stat
                key={n}
                label={NOW[n].label}
                value={String(tally(n))}
                className={n === 'waiting' ? '@max-[40rem]/now:hidden' : undefined}
              />
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-fg-muted">Nobody reports to you.</p>
          ) : (
            <List aria-label="Your team">
              {rows.map((r) => (
                <ListItem
                  key={r.personId}
                  leading={<Avatar name={r.displayName} />}
                  description={
                    r.back !== undefined ? (
                      `Back ${shortDate(nextWorkingDay(r.back))}`
                    ) : r.workModel === null ? undefined : (
                      <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5">
                        {icon(WHERE_ICON[r.workModel])}
                        {WHERE[r.workModel]}
                      </span>
                    )
                  }
                  trailing={
                    <span className="flex items-center gap-4">
                      {r.now === 'away' ? null : (
                        <DayBar
                          label={`${r.displayName} today`}
                          segments={r.today.segments}
                          now={minute}
                          axis={false}
                          className="w-64 @max-[40rem]/now:hidden"
                        />
                      )}
                      <Badge size="sm" tone={NOW[r.now].tone} dot={r.now !== 'away'}>
                        {r.badge}
                      </Badge>
                    </span>
                  }
                >
                  {r.displayName}
                </ListItem>
              ))}
            </List>
          )}
          <p className="flex gap-2 text-xs text-fg-muted [&_svg]:size-3.5 [&_svg]:shrink-0">
            <icons.hidden aria-hidden />
            Only the punches people make. No location trail and no screen tracking.
          </p>
        </div>
        <PageSection title="Needs you">
          {data.needsYou.length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing waiting for you.</p>
          ) : (
            <List>
              {data.needsYou.map((n) => (
                <ListItem
                  key={`${n.kind} ${n.personId} ${n.date}`}
                  icon={icon(n.kind === 'correction' ? 'history' : 'overtime')}
                  iconTone={n.kind === 'correction' ? 'danger' : 'info'}
                  description={
                    n.kind === 'correction'
                      ? `${shortDate(n.date)} · added afterwards`
                      : shortDate(n.date)
                  }
                  trailing={
                    <Button size="xs" asChild>
                      <a
                        href={`/time-off/attendance/timesheets?person=${n.personId}&week=${n.date}`}
                        aria-label={`Review ${n.displayName}’s ${n.kind === 'correction' ? 'correction' : 'overtime'}`}
                      >
                        Review
                      </a>
                    </Button>
                  }
                >
                  {n.kind === 'correction'
                    ? `${n.displayName} · ${weekdayName(n.date)} ${n.punch?.kind === 'in' ? 'clock-in' : 'clock-out'}`
                    : `${n.displayName} · ${duration(n.minutes ?? 0)} overtime`}
                </ListItem>
              ))}
            </List>
          )}
        </PageSection>
      </div>
    </>
  );
}

/** The board while it loads, in its exact shape: the counts, the rows, Needs you. */
export function TeamNowSkeleton(): JSX.Element {
  return (
    <div className="@container/now flex flex-col gap-6">
      <PageHeader title="Attendance" description={' '} />
      <div role="status" className={body}>
        <span className="sr-only">Loading your team right now</span>
        <div className="flex min-w-0 flex-col gap-5">
          <div className={counts}>
            {[0, 1, 2, 3].map((n) => (
              <Skeleton
                key={n}
                className={`h-22 rounded-lg ${n === 2 ? '@max-[40rem]/now:hidden' : ''}`}
              />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <Skeleton key={n} className="h-14 rounded-sm" />
            ))}
          </div>
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    </div>
  );
}
