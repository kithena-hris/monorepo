import {
  AssistantCard,
  Avatar,
  Badge,
  BarChart,
  Button,
  ChartCard,
  dateFormat,
  List,
  ListItem,
  PageHeader,
  PageSection,
  Separator,
  Skeleton,
  StackedBarChart,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@reach/ui';
import type { JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { amount, longDate, shortDate } from '../words';
import { Nudge, type NudgeData, type NudgeProps } from './nudge';
import { t as tr } from '../i18n';

/**
 * Insights (T27, PRD §14.2): time off and attendance across the company for
 * HR, or a manager's reports — unbooked days, people who have not had a
 * break, attendance trends — on four tabs, each its own address: What
 * changed, Time off, Attendance and Balances.
 *
 * Every number is Time Off's; the sentences are written from them (templated
 * until the assistant writes them). Every point links to the people behind
 * it (`?point=`), drawn beside it. **A group smaller than the cohort minimum
 * is never described**: small teams are left out of the per-team figures,
 * and sick leave appears only as a total for a group at or above it.
 */

type PointKind = 'unbooked' | 'no_break' | 'missed_clock_outs' | 'overtime';
export type InsightsTab = 'what-changed' | 'time-off' | 'attendance' | 'balances';

export interface InsightsData {
  readonly tab: InsightsTab;
  /** The point whose people are open beside it. */
  readonly point: string | null;
  readonly asOf: string;
  readonly scope: 'company' | 'team';
  readonly cohortMinimum: number;
  readonly points: readonly {
    readonly kind: PointKind;
    readonly figure: string;
    readonly text: string;
    /** A model wrote `text` (TOF-097 on the assistant's writer). */
    readonly ai?: boolean;
    readonly sources: readonly string[];
    readonly personIds: readonly string[];
  }[];
  readonly months: readonly {
    readonly month: string;
    readonly vacation: string;
    readonly personal: string;
    readonly sick: string | null;
    readonly missedClockOuts: number;
    readonly overtimeMinutes: number;
  }[];
  readonly teams: readonly {
    readonly team: string;
    readonly teamName: string | null;
    readonly people: number;
    readonly daysTaken: string;
    readonly overtimeMinutes: number;
    readonly left: string;
  }[];
  readonly hiddenTeams: number;
  readonly people: readonly {
    readonly personId: string;
    readonly displayName: string;
    readonly teamName: string | null;
    readonly left: string;
    readonly losesAtYearEnd: string;
    readonly lastDayOff: string | null;
  }[];
  /** T28's dialog, open (`?nudge=no_break`) with who it reaches and one message. */
  readonly nudge?: NudgeData | null;
}

export interface InsightsProps {
  readonly load: Loadable<InsightsData>;
  /** Another state in the address: the nudge opened or closed, what it includes. */
  readonly onAsk?: (patch: Readonly<Record<string, string | null>>) => void;
  /** T28's send: each person their own message. */
  readonly onSendNudges?: NudgeProps['onSend'];
}

const body =
  'flex flex-col gap-6 @min-[60rem]/insights:grid @min-[60rem]/insights:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] @min-[60rem]/insights:items-start';

const monthShort = (month: string): string =>
  dateFormat({ month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
const monthLong = (month: string): string =>
  dateFormat({ month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
const n = (s: string): number => Number(s);
const people = (count: number): string =>
  tr(
    'insights.insights.people',
    { one: '{{count}} person', other: '{{count}} people' },
    { count: count },
  );
const hoursOf = (minutes: number): string =>
  tr('insights.insights.h', '{{round}}h', { round: String(Math.round(minutes / 60)) });

/** Why a point is there in a word: the link that opens its people. */
const BEHIND: Record<PointKind, string> = {
  get unbooked(): string {
    return tr('insights.insights.who_would_lose_days', 'who would lose days');
  },
  get no_break(): string {
    return tr('insights.insights.who_has_had_no_break', 'who has had no break');
  },
  missed_clock_outs: '',
  overtime: '',
};

export function Insights({ load, onAsk, onSendNudges }: InsightsProps): JSX.Element {
  if (load.status === 'loading') return <InsightsSkeleton />;
  return (
    <div className="@container/insights flex flex-col gap-6">
      {load.status === 'error' ? (
        <PageHeader title={tr('insights.insights.insights', 'Insights')} />
      ) : null}
      <Loaded load={load} what={tr('insights.insights.the_insights', 'the insights')}>
        {(data) => (
          <>
            <PageHeader
              title={tr('insights.insights.insights', 'Insights')}
              description={
                data.scope === 'company'
                  ? tr(
                      'insights.insights.across_the_company_as_of',
                      'Time off and attendance across the company · {{people}} · as of {{longDate}}',
                      { people: people(data.people.length), longDate: longDate(data.asOf) },
                    )
                  : tr(
                      'insights.insights.for_your_team_as_of',
                      'Time off and attendance for your team · {{people}} · as of {{longDate}}',
                      { people: people(data.people.length), longDate: longDate(data.asOf) },
                    )
              }
            />
            {data.tab === 'what-changed' ? <WhatChanged data={data} /> : null}
            {data.tab === 'time-off' ? <TimeOffTab data={data} /> : null}
            {data.tab === 'attendance' ? <AttendanceTab data={data} /> : null}
            {data.tab === 'balances' ? <BalancesTab data={data} /> : null}
            <p className="text-xs text-fg-muted">
              {data.hiddenTeams === 0
                ? tr(
                    'insights.insights.groups_under_people_are_never_described',
                    'Groups under {{cohortMinimum}} people are never described, and sick leave is only ever a total for a group that size or larger.',
                    { cohortMinimum: data.cohortMinimum },
                  )
                : tr(
                    'insights.insights.groups_never_described_teams_left_out',
                    {
                      one: 'Groups under {{cohortMinimum}} people are never described, and sick leave is only ever a total for a group that size or larger. {{count}} smaller team is left out of the per-team figures.',
                      other:
                        'Groups under {{cohortMinimum}} people are never described, and sick leave is only ever a total for a group that size or larger. {{count}} smaller teams are left out of the per-team figures.',
                    },
                    { cohortMinimum: data.cohortMinimum, count: data.hiddenTeams },
                  )}
            </p>
            {data.nudge === null || data.nudge === undefined ? null : (
              <Nudge
                nudge={data.nudge}
                onAsk={onAsk}
                onSend={onSendNudges}
                onClose={() => onAsk?.({ nudge: null })}
              />
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}

/* ---------------------------------------------------------- what changed -- */

function WhatChanged({ data }: { readonly data: InsightsData }): JSX.Element {
  const month = data.asOf.slice(0, 7);
  const open = data.points.find((p) => p.kind === data.point && p.personIds.length > 0);
  return (
    <div className={body}>
      <AssistantCard
        level={2}
        title={tr(
          'insights.insights.in',
          { one: '{{monthLong}} in {{count}} point', other: '{{monthLong}} in {{count}} points' },
          { count: data.points.length, monthLong: monthLong(month) },
        )}
        action={
          <Badge tone="assistant" size="sm">
            {data.points.some((p) => p.ai === true)
              ? 'AI'
              : tr('insights.insights.templated', 'Templated')}
          </Badge>
        }
        note={tr(
          'insights.insights.written_from_time_offs_own_numbers',
          'Written from Time Off’s own numbers. Each point links to the people behind it.',
        )}
      >
        {data.points.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {tr(
              'insights.insights.nothing_changed_worth_saying_this_month',
              'Nothing changed worth saying this month.',
            )}
          </p>
        ) : (
          <ol
            aria-label={tr('insights.insights.what_changed', 'What changed')}
            className="flex flex-col gap-3"
          >
            {data.points.map((p, i) => (
              <li key={p.kind} className="flex flex-col gap-3">
                {i === 0 ? null : <Separator />}
                <div className="flex items-start gap-3.5">
                  <Badge size="lg" variant="outline">
                    {p.figure}
                  </Badge>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <p className="text-[0.9375rem]/[1.5]">{p.text}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.sources.map((s) => (
                        <Badge key={s} size="sm">
                          {s}
                        </Badge>
                      ))}
                      {p.personIds.length === 0 || BEHIND[p.kind] === '' ? null : (
                        <Button asChild size="xs" variant="ghost">
                          <a
                            href={`/time-off/insights/what-changed?point=${p.kind}`}
                            aria-label={tr(
                              'insights.insights.see_the',
                              'See the {{length}}: {{BEHIND}}',
                              { length: String(p.personIds.length), BEHIND: BEHIND[p.kind] },
                            )}
                          >
                            {tr('insights.insights.see_the_2', 'See the {{length}}', {
                              length: String(p.personIds.length),
                            })}
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </AssistantCard>
      {open === undefined ? <DaysTaken data={data} /> : <Behind data={data} point={open} />}
    </div>
  );
}

/** The people behind a point, with what it says about each. */
function Behind({
  data,
  point,
}: {
  readonly data: InsightsData;
  readonly point: InsightsData['points'][number];
}): JSX.Element {
  const ids = new Set(point.personIds);
  const who = data.people.filter((p) => ids.has(p.personId));
  return (
    <PageSection
      title={
        point.kind === 'unbooked'
          ? tr('insights.insights.who_would_lose_days_2', 'Who would lose days')
          : tr('insights.insights.no_day_off_since', 'No day off since')
      }
      description={people(who.length)}
      actions={
        point.kind === 'no_break' ? (
          <Button asChild size="sm" variant="primary">
            <a href={`/time-off/insights/what-changed?point=no_break&nudge=no_break`}>
              {tr('insights.insights.nudge_the', 'Nudge the {{length}}', {
                length: String(who.length),
              })}
            </a>
          </Button>
        ) : undefined
      }
      surface
    >
      <List aria-label={tr('insights.insights.the_people_behind_it', 'The people behind it')}>
        {who.map((p) => (
          <ListItem
            key={p.personId}
            leading={<Avatar name={p.displayName} />}
            description={
              point.kind === 'unbooked'
                ? tr(
                    'insights.insights.of_days_lost_at_the_year',
                    '{{losesAtYearEnd}} of {{left}} days lost at the year end',
                    { losesAtYearEnd: amount(p.losesAtYearEnd), left: amount(p.left) },
                  )
                : p.lastDayOff === null
                  ? tr('insights.insights.no_day_off_this_year', 'No day off this year')
                  : tr('insights.insights.last_day_off', 'Last day off {{lastDayOff}}', {
                      lastDayOff: shortDate(p.lastDayOff),
                    })
            }
            meta={p.teamName ?? undefined}
          >
            {p.displayName}
          </ListItem>
        ))}
      </List>
    </PageSection>
  );
}

function DaysTaken({ data }: { readonly data: InsightsData }): JSX.Element {
  const sick = data.months.every((m) => m.sick !== null);
  const year = data.months.filter((m) => m.month.startsWith(data.asOf.slice(0, 4)));
  const total = year.reduce(
    (t, m) => t + n(m.vacation) + n(m.personal) + (m.sick === null ? 0 : n(m.sick)),
    0,
  );
  return (
    <ChartCard
      title={tr('insights.insights.days_taken_by_month', 'Days taken by month')}
      value={amount(total.toFixed(3))}
      description={tr('insights.insights.the_last_months', 'The last {{length}} months', {
        length: String(data.months.length),
      })}
    >
      <StackedBarChart
        label={tr('insights.insights.days_taken_by_month', 'Days taken by month')}
        categories={data.months.map((m) => monthShort(m.month))}
        series={[
          {
            label: tr('insights.insights.vacation', 'Vacation'),
            tone: 'chart-1',
            values: data.months.map((m) => n(m.vacation)),
          },
          {
            label: tr('insights.insights.personal', 'Personal'),
            tone: 'chart-2',
            values: data.months.map((m) => n(m.personal)),
          },
          ...(sick
            ? [
                {
                  label: tr('insights.insights.sick', 'Sick'),
                  tone: 'chart-3' as const,
                  values: data.months.map((m) => n(m.sick ?? '0')),
                },
              ]
            : []),
        ]}
        height={160}
      />
    </ChartCard>
  );
}

/* --------------------------------------------------------------- tabs -- */

function Teams({
  data,
  label,
  value,
  of,
}: {
  readonly data: InsightsData;
  readonly label: string;
  readonly value: string;
  readonly of: (t: InsightsData['teams'][number]) => string;
}): JSX.Element {
  if (data.teams.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        {tr(
          'insights.insights.no_team_is_large_enough_to',
          'No team is large enough to describe on its own.',
        )}
      </p>
    );
  }
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>{tr('insights.insights.team', 'Team')}</TableHead>
          <TableHead className="text-end">{tr('insights.insights.people_2', 'People')}</TableHead>
          <TableHead className="text-end">{value}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.teams.map((t) => (
          <TableRow key={t.team}>
            <TableCell className="font-semibold">
              {t.teamName ?? tr('insights.insights.no_team', 'No team')}
            </TableCell>
            <TableCell className="text-end tabular-nums">{t.people}</TableCell>
            <TableCell className="text-end tabular-nums">{of(t)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TimeOffTab({ data }: { readonly data: InsightsData }): JSX.Element {
  return (
    <div className={body}>
      <PageSection title={tr('insights.insights.by_month', 'By month')}>
        <DaysTaken data={data} />
      </PageSection>
      <PageSection title={tr('insights.insights.by_team', 'By team')} surface>
        <Teams
          data={data}
          label={tr('insights.insights.days_taken_by_team', 'Days taken by team')}
          value="Days taken"
          of={(t) => amount(t.daysTaken)}
        />
      </PageSection>
    </div>
  );
}

function AttendanceTab({ data }: { readonly data: InsightsData }): JSX.Element {
  const now = data.months.at(-1);
  return (
    <div className={body}>
      <PageSection title={tr('insights.insights.by_month', 'By month')}>
        <ChartCard
          title={tr('insights.insights.missed_clock_outs_by_month', 'Missed clock-outs by month')}
          value={String(now?.missedClockOuts ?? 0)}
          description={tr('insights.insights.this_month_so_far', 'This month so far')}
        >
          <BarChart
            label={tr('insights.insights.missed_clock_outs_by_month', 'Missed clock-outs by month')}
            data={data.months.map((m) => ({
              label: monthShort(m.month),
              value: m.missedClockOuts,
            }))}
            tone="chart-4"
            height={140}
          />
        </ChartCard>
        <ChartCard
          title={tr('insights.insights.overtime_by_month', 'Overtime by month')}
          value={hoursOf(now?.overtimeMinutes ?? 0)}
          description={tr('insights.insights.this_month_so_far', 'This month so far')}
        >
          <BarChart
            label={tr('insights.insights.overtime_hours_by_month', 'Overtime hours by month')}
            data={data.months.map((m) => ({
              label: monthShort(m.month),
              value: Math.round(m.overtimeMinutes / 60),
            }))}
            tone="chart-5"
            format={(v) => tr('insights.insights.h_2', '{{v}}h', { v: String(v) })}
            height={140}
          />
        </ChartCard>
      </PageSection>
      <PageSection title={tr('insights.insights.overtime_by_team', 'Overtime by team')} surface>
        <Teams
          data={data}
          label={tr('insights.insights.overtime_by_team', 'Overtime by team')}
          value="Overtime"
          of={(t) => hoursOf(t.overtimeMinutes)}
        />
      </PageSection>
    </div>
  );
}

function BalancesTab({ data }: { readonly data: InsightsData }): JSX.Element {
  const losing = data.people
    .filter((p) => n(p.losesAtYearEnd) > 0)
    .toSorted((a, b) => n(b.losesAtYearEnd) - n(a.losesAtYearEnd));
  const unbooked = data.people.reduce((t, p) => t + Math.max(0, n(p.left)), 0);
  return (
    <div className={body}>
      <PageSection
        title={tr('insights.insights.who_would_lose_days_2', 'Who would lose days')}
        description={tr(
          'insights.insights.above_the_carry_over_at_the',
          'Above the carry-over at the year end, if nothing more is booked',
        )}
        surface
      >
        {losing.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {tr(
              'insights.insights.nobody_would_lose_days_at_the',
              'Nobody would lose days at the year end.',
            )}
          </p>
        ) : (
          <List aria-label={tr('insights.insights.who_would_lose_days_2', 'Who would lose days')}>
            {losing.map((p) => (
              <ListItem
                key={p.personId}
                leading={<Avatar name={p.displayName} />}
                description={tr('insights.insights.days_left', '{{left}} days left', {
                  left: amount(p.left),
                })}
                meta={p.teamName ?? undefined}
                trailing={<Badge size="sm" tone="warning">{`−${amount(p.losesAtYearEnd)}`}</Badge>}
              >
                {p.displayName}
              </ListItem>
            ))}
          </List>
        )}
      </PageSection>
      <div className="flex min-w-0 flex-col gap-6">
        <div className="grid grid-cols-2 gap-3">
          <Stat
            label={tr('insights.insights.unbooked_days', 'Unbooked days')}
            value={amount(unbooked.toFixed(3))}
          />
          <Stat
            label={tr('insights.insights.would_lose_some', 'Would lose some')}
            value={String(losing.length)}
          />
        </div>
        <PageSection title={tr('insights.insights.days_left_by_team', 'Days left by team')} surface>
          <Teams
            data={data}
            label={tr('insights.insights.days_left_by_team', 'Days left by team')}
            value="Days left"
            of={(t) => amount(t.left)}
          />
        </PageSection>
      </div>
    </div>
  );
}

/** The page while it loads: the header, the summary card and the chart beside it. */
export function InsightsSkeleton(): JSX.Element {
  return (
    <div className="@container/insights flex flex-col gap-6">
      <PageHeader title={tr('insights.insights.insights', 'Insights')} description={' '} />
      <div role="status" className={body}>
        <span className="sr-only">
          {tr('insights.insights.loading_the_insights', 'Loading the insights')}
        </span>
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}
