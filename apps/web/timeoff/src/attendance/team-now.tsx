import {
  AssistantCard,
  Avatar,
  Badge,
  Button,
  List,
  ListItem,
  PageSection,
  Skeleton,
  SegmentedControl,
  SegmentedControlItem,
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
import { t } from '../i18n';
import { Header } from '../frame';
import { useHeld } from '../held';
import { ATTENDANCE } from './section';

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
  /** Today, in a sentence: Time Off's, the model's or its template (TOF-091). */
  readonly sentence?: { readonly text: string; readonly ai: boolean };
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
  /** Whom the list shows (`?show=in`), held by the host in the address. */
  readonly show?: string | null;
  readonly onShow?: (show: string | null) => void;
}

export function TeamNow({ load, show, onShow }: TeamNowProps): JSX.Element {
  if (load.status === 'loading') return <TeamNowSkeleton />;
  return (
    <div className="@container/now flex flex-col gap-6">
      {load.status === 'error' ? <Header fallback={ATTENDANCE()} /> : null}
      <Loaded
        load={load}
        what={t('attendance.team-now.your_team_right_now', 'your team right now')}
      >
        {(data) => <Ready data={data} show={show} onShow={onShow} />}
      </Loaded>
    </div>
  );
}

const body =
  'flex flex-col gap-5 @min-[60rem]/now:grid @min-[60rem]/now:grid-cols-[minmax(0,1fr)_20rem] @min-[60rem]/now:items-start';

type Now = 'in' | 'break' | 'waiting' | 'away' | 'done';

const NOW: Record<Now, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  in: {
    get label(): string {
      return t('attendance.team-now.in', 'In');
    },
    tone: 'success',
  },
  break: {
    get label(): string {
      return t('attendance.team-now.on_a_break', 'On a break');
    },
    tone: 'warning',
  },
  waiting: {
    get label(): string {
      return t('attendance.team-now.not_in_yet', 'Not in yet');
    },
    tone: 'neutral',
  },
  away: {
    get label(): string {
      return t('attendance.team-now.away', 'Away');
    },
    tone: 'neutral',
  },
  done: {
    get label(): string {
      return t('attendance.team-now.clocked_out', 'Clocked out');
    },
    tone: 'neutral',
  },
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

const SHOWS = ['all', 'in', 'break', 'waiting', 'away'] as const;
type Show = (typeof SHOWS)[number];

function Ready({
  data,
  show: heldShow,
  onShow,
}: {
  readonly data: TeamNowData;
  readonly show?: string | null | undefined;
  readonly onShow?: ((show: string | null) => void) | undefined;
}): JSX.Element {
  const [held, setShow] = useHeld<string | null>(heldShow, onShow, null);
  const show: Show = SHOWS.find((v) => v === held) ?? 'all';
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
        ? t('attendance.team-now.in_2', 'In · {{duration}}', {
            duration: duration(p.today.workedMinutes ?? 0),
          })
        : now === 'break'
          ? t('attendance.team-now.break', 'Break · {{duration}}', {
              duration: duration(lastBreak === undefined ? 0 : lastBreak.to - lastBreak.from),
            })
          : NOW[now].label;
    const back = away.get(p.personId);
    return { ...p, now, badge, back };
  });
  const tally = (now: Now): number => rows.filter((r) => r.now === now).length;
  // Finished for the day counts as in: they came, and the filter is about who is here.
  const shown =
    show === 'all' ? rows : rows.filter((r) => (r.now === 'done' ? 'in' : r.now) === show);

  return (
    <>
      <Header fallback={ATTENDANCE()} />
      <div className={body}>
        <div className="flex min-w-0 flex-col gap-5">
          {/* Who is where, as a filter: each count narrows the list to its people. */}
          <SegmentedControl
            aria-label={t('attendance.team-now.who_to_show', 'Who to show')}
            className="max-w-full overflow-x-auto"
            value={show}
            onValueChange={(next) => {
              if (next !== '') setShow(next === 'all' ? null : next);
            }}
          >
            {SHOWS.map((v) => (
              <SegmentedControlItem key={v} value={v}>
                {v === 'all' ? t('attendance.team-now.everyone', 'Everyone') : NOW[v].label}{' '}
                <span className="opacity-60 tabular-nums">
                  {String(
                    v === 'all' ? rows.length : v === 'in' ? tally('in') + tally('done') : tally(v),
                  )}
                </span>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          {rows.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {t('attendance.team-now.nobody_reports_to_you', 'Nobody reports to you.')}
            </p>
          ) : (
            <List aria-label={t('attendance.team-now.your_team', 'Your team')}>
              {shown.map((r) => (
                <ListItem
                  key={r.personId}
                  leading={<Avatar name={r.displayName} />}
                  description={
                    r.back !== undefined ? (
                      t('attendance.team-now.back', 'Back {{nextWorkingDay}}', {
                        nextWorkingDay: shortDate(nextWorkingDay(r.back)),
                      })
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
                          label={t('attendance.team-now.today', '{{displayName}} today', {
                            displayName: r.displayName,
                          })}
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
            {t(
              'attendance.team-now.only_the_punches_people_make_no',
              'Only the punches people make. No location trail and no screen tracking.',
            )}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {data.sentence === undefined ? null : (
            <AssistantCard
              level={2}
              title={t('attendance.team-now.today_in_a_sentence', 'Today, in a sentence')}
              action={
                data.sentence.ai ? (
                  <Badge tone="assistant" size="sm">
                    {t('attendance.team-now.ai', 'AI')}
                  </Badge>
                ) : undefined
              }
            >
              <p className="text-sm text-fg-muted">{data.sentence.text}</p>
            </AssistantCard>
          )}
          <PageSection title={t('attendance.team-now.needs_you', 'Needs you')}>
            {data.needsYou.length === 0 ? (
              <p className="text-sm text-fg-muted">
                {t('attendance.team-now.nothing_waiting_for_you', 'Nothing waiting for you.')}
              </p>
            ) : (
              <List>
                {data.needsYou.map((n) => (
                  <ListItem
                    key={`${n.kind} ${n.personId} ${n.date}`}
                    icon={icon(n.kind === 'correction' ? 'history' : 'overtime')}
                    iconTone={n.kind === 'correction' ? 'danger' : 'info'}
                    description={
                      n.kind === 'correction'
                        ? t('attendance.team-now.added_afterwards', '{{date}} · added afterwards', {
                            date: shortDate(n.date),
                          })
                        : shortDate(n.date)
                    }
                    trailing={
                      <Button size="xs" asChild>
                        <a
                          // Overtime and late corrections are decided in one place.
                          href="/time-off/attendance/requests"
                          aria-label={
                            n.kind === 'correction'
                              ? t(
                                  'attendance.team-now.review_correction',
                                  'Review {{displayName}}’s correction',
                                  {
                                    displayName: n.displayName,
                                  },
                                )
                              : t(
                                  'attendance.team-now.review_overtime',
                                  'Review {{displayName}}’s overtime',
                                  {
                                    displayName: n.displayName,
                                  },
                                )
                          }
                        >
                          {t('attendance.team-now.review', 'Review')}
                        </a>
                      </Button>
                    }
                  >
                    {n.kind === 'correction'
                      ? n.punch?.kind === 'in'
                        ? t(
                            'attendance.requests.name_weekday_clock_in',
                            '{{displayName}} · {{weekdayName}} clock-in',
                            {
                              displayName: n.displayName,
                              weekdayName: weekdayName(n.date),
                            },
                          )
                        : t(
                            'attendance.requests.name_weekday_clock_out',
                            '{{displayName}} · {{weekdayName}} clock-out',
                            {
                              displayName: n.displayName,
                              weekdayName: weekdayName(n.date),
                            },
                          )
                      : t(
                          'attendance.team-now.overtime',
                          '{{displayName}} · {{duration}} overtime',
                          { displayName: n.displayName, duration: duration(n.minutes ?? 0) },
                        )}
                  </ListItem>
                ))}
              </List>
            )}
          </PageSection>
        </div>
      </div>
    </>
  );
}

/** The board while it loads, in its exact shape: the filter, the rows, Needs you. */
export function TeamNowSkeleton(): JSX.Element {
  return (
    <div className="@container/now flex flex-col gap-6">
      <Header fallback={ATTENDANCE()} />
      <div role="status" className={body}>
        <span className="sr-only">
          {t('attendance.team-now.loading_your_team_right_now', 'Loading your team right now')}
        </span>
        <div className="flex min-w-0 flex-col gap-5">
          <Skeleton className="h-9 w-full max-w-[34rem] rounded-full" />
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
