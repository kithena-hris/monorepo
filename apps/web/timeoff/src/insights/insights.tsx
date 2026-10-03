import {
  AssistantCard,
  Avatar,
  BarChart,
  Badge,
  Button,
  ChartCard,
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
import type { JSX, ReactNode } from 'react';

import { Loaded, type Loadable } from '../load';
import { amount, longDate, shortDate } from '../words';

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
}

export interface InsightsProps {
  readonly load: Loadable<InsightsData>;
  /** T28's dialog over the page, when a point can nudge its people (TOF-098). */
  readonly nudge?: (data: InsightsData) => ReactNode;
}

const body =
  'flex flex-col gap-6 @min-[60rem]/insights:grid @min-[60rem]/insights:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] @min-[60rem]/insights:items-start';

const monthShort = (month: string): string =>
  new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
const monthLong = (month: string): string =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
const n = (s: string): number => Number(s);
const people = (count: number): string => (count === 1 ? '1 person' : `${String(count)} people`);
const hoursOf = (minutes: number): string => `${String(Math.round(minutes / 60))}h`;

/** Why a point is there in a word: the link that opens its people. */
const BEHIND: Record<PointKind, string> = {
  unbooked: 'who would lose days',
  no_break: 'who has had no break',
  missed_clock_outs: '',
  overtime: '',
};

export function Insights({ load, nudge }: InsightsProps): JSX.Element {
  if (load.status === 'loading') return <InsightsSkeleton />;
  return (
    <div className="@container/insights flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Insights" /> : null}
      <Loaded load={load} what="the insights">
        {(data) => (
          <>
            <PageHeader
              title="Insights"
              description={`Time off and attendance ${
                data.scope === 'company' ? 'across the company' : 'for your team'
              } · ${people(data.people.length)} · as of ${longDate(data.asOf)}`}
            />
            {data.tab === 'what-changed' ? <WhatChanged data={data} /> : null}
            {data.tab === 'time-off' ? <TimeOffTab data={data} /> : null}
            {data.tab === 'attendance' ? <AttendanceTab data={data} /> : null}
            {data.tab === 'balances' ? <BalancesTab data={data} /> : null}
            <p className="text-xs text-fg-muted">
              {`Groups under ${String(data.cohortMinimum)} people are never described, and sick leave is only ever a total for a group that size or larger.${
                data.hiddenTeams === 0
                  ? ''
                  : ` ${String(data.hiddenTeams)} smaller ${data.hiddenTeams === 1 ? 'team is' : 'teams are'} left out of the per-team figures.`
              }`}
            </p>
            {nudge?.(data)}
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
        title={`${monthLong(month)} in ${String(data.points.length)} ${data.points.length === 1 ? 'point' : 'points'}`}
        action={
          <Badge tone="assistant" size="sm">
            Templated
          </Badge>
        }
        note="Written from Time Off’s own numbers. Each point links to the people behind it."
      >
        {data.points.length === 0 ? (
          <p className="text-sm text-fg-muted">Nothing changed worth saying this month.</p>
        ) : (
          <ol aria-label="What changed" className="flex flex-col gap-3">
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
                            aria-label={`See ${people(p.personIds.length)}: ${BEHIND[p.kind]}`}
                          >
                            {`See the ${String(p.personIds.length)}`}
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
      title={point.kind === 'unbooked' ? 'Who would lose days' : 'No day off since'}
      description={people(who.length)}
      actions={
        point.kind === 'no_break' ? (
          <Button asChild size="sm" variant="primary">
            <a href={`/time-off/insights/what-changed?point=no_break&nudge=no_break`}>
              {`Nudge the ${String(who.length)}`}
            </a>
          </Button>
        ) : undefined
      }
      surface
    >
      <List aria-label="The people behind it">
        {who.map((p) => (
          <ListItem
            key={p.personId}
            leading={<Avatar name={p.displayName} />}
            description={
              point.kind === 'unbooked'
                ? `${amount(p.losesAtYearEnd)} of ${amount(p.left)} days lost at the year end`
                : p.lastDayOff === null
                  ? 'No day off this year'
                  : `Last day off ${shortDate(p.lastDayOff)}`
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
      title="Days taken by month"
      value={amount(total.toFixed(3))}
      description={`The last ${String(data.months.length)} months`}
    >
      <StackedBarChart
        label="Days taken by month"
        categories={data.months.map((m) => monthShort(m.month))}
        series={[
          { label: 'Vacation', tone: 'chart-1', values: data.months.map((m) => n(m.vacation)) },
          { label: 'Personal', tone: 'chart-2', values: data.months.map((m) => n(m.personal)) },
          ...(sick
            ? [
                {
                  label: 'Sick',
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
    return <p className="text-sm text-fg-muted">No team is large enough to describe on its own.</p>;
  }
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>Team</TableHead>
          <TableHead className="text-end">People</TableHead>
          <TableHead className="text-end">{value}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.teams.map((t) => (
          <TableRow key={t.team}>
            <TableCell className="font-semibold">{t.teamName ?? 'No team'}</TableCell>
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
      <PageSection title="By month">
        <DaysTaken data={data} />
      </PageSection>
      <PageSection title="By team" surface>
        <Teams
          data={data}
          label="Days taken by team"
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
      <PageSection title="By month">
        <ChartCard
          title="Missed clock-outs by month"
          value={String(now?.missedClockOuts ?? 0)}
          description="This month so far"
        >
          <BarChart
            label="Missed clock-outs by month"
            data={data.months.map((m) => ({
              label: monthShort(m.month),
              value: m.missedClockOuts,
            }))}
            tone="chart-4"
            height={140}
          />
        </ChartCard>
        <ChartCard
          title="Overtime by month"
          value={hoursOf(now?.overtimeMinutes ?? 0)}
          description="This month so far"
        >
          <BarChart
            label="Overtime hours by month"
            data={data.months.map((m) => ({
              label: monthShort(m.month),
              value: Math.round(m.overtimeMinutes / 60),
            }))}
            tone="chart-5"
            format={(v) => `${String(v)}h`}
            height={140}
          />
        </ChartCard>
      </PageSection>
      <PageSection title="Overtime by team" surface>
        <Teams
          data={data}
          label="Overtime by team"
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
        title="Who would lose days"
        description="Above the carry-over at the year end, if nothing more is booked"
        surface
      >
        {losing.length === 0 ? (
          <p className="text-sm text-fg-muted">Nobody would lose days at the year end.</p>
        ) : (
          <List aria-label="Who would lose days">
            {losing.map((p) => (
              <ListItem
                key={p.personId}
                leading={<Avatar name={p.displayName} />}
                description={`${amount(p.left)} days left`}
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
          <Stat label="Unbooked days" value={amount(unbooked.toFixed(3))} />
          <Stat label="Would lose some" value={String(losing.length)} />
        </div>
        <PageSection title="Days left by team" surface>
          <Teams
            data={data}
            label="Days left by team"
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
      <PageHeader title="Insights" description={' '} />
      <div role="status" className={body}>
        <span className="sr-only">Loading the insights</span>
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}
