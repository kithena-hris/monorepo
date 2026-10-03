import {
  Alert,
  Avatar,
  Badge,
  Button,
  CalendarHeatmap,
  ChartLegend,
  CopyField,
  List,
  ListItem,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Scheduler,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  icons,
  type SchedulerEvent,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import type { DecisionData } from '../approvals/decision';
import { TeamTimeline, calendarColumns } from '../approvals/timeline';
import {
  addDays,
  datesIn,
  firstName,
  isWeekend,
  longDate,
  lookOf,
  mondayOf,
  monthName,
  spanLabel,
  tentative,
  type CalendarView,
  type LeaveTypeLook,
  type Range,
} from '../approvals/words';
import { ClashCard } from './clash';

/**
 * The team calendar (T12–T15, MT13, MT14, §10.1): who is away by month, as
 * a timeline with the count of who is in, and across the year. Each view is
 * its own address; the team or company or me, the month or week and the
 * clash being solved are in the query, and so are the types and holiday
 * calendars shown and the day open, which the screen applies to what it
 * has without asking Time Off again.
 *
 * Under 40rem of its own width it is MT13: a working week of the timeline,
 * a week at a time, and a tapped day opens as a sheet (MT14).
 */

export type CalendarViewName = 'month' | 'timeline' | 'year';
export type Scope = 'team' | 'company' | 'me';

export interface TeamCalendarData {
  readonly view: CalendarViewName;
  readonly scope: Scope;
  readonly teamKey: string | null;
  /** "2026-10". */
  readonly month: string;
  /** The Monday of the week a phone shows. */
  readonly week: string;
  readonly year: number;
  readonly today: string;
  /** Month and timeline: the month, and the phone's week where it crosses into another. */
  readonly calendar: CalendarView | null;
  /** Year: how many people are off each day. */
  readonly days: readonly { readonly date: string; readonly off: number }[] | null;
  readonly types: readonly LeaveTypeLook[];
  /** Timeline: a request that breaks the minimum, and the fixes for it (T15). */
  readonly clash: DecisionData | null;
}

export interface TeamCalendarProps {
  readonly load: Loadable<TeamCalendarData>;
  /** The address it is drawn at, without its query. */
  readonly path?: string;
  /** The query as it is now. */
  readonly query?: Readonly<Record<string, string>>;
  /** What Time Off answers differently: a month, a week, a scope, a team, a clash. */
  readonly onNavigate?: (href: string) => void;
  /** What the screen applies itself: the types, the holidays, the day open. */
  readonly onFilter?: (patch: Readonly<Record<string, string | null>>) => void;
  /** A signed feed address for this scope, for a calendar app (§10.1). */
  readonly onSubscribe?: (
    scope: Scope,
  ) => Promise<
    { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string }
  >;
  readonly onSuggest?: (
    requestId: string,
    proposals: readonly { readonly spans: readonly Range[] }[],
  ) => Promise<Outcome>;
  readonly onDecide?: (requestId: string, decision: 'approve' | 'decline') => Promise<Outcome>;
}

const viewOf = (path: string | undefined): CalendarViewName =>
  path?.endsWith('/timeline') === true
    ? 'timeline'
    : path?.endsWith('/year') === true
      ? 'year'
      : 'month';

export function TeamCalendar(props: TeamCalendarProps): JSX.Element {
  const { load, path } = props;
  if (load.status === 'loading') return <TeamCalendarSkeleton view={viewOf(path)} />;
  return (
    <div className="@container/calendar flex flex-col gap-4">
      <PageHeader title="Calendar" />
      <Loaded load={load} what="the calendar">
        {(data) => <Ready {...props} data={data} />}
      </Loaded>
    </div>
  );
}

/** Under 40rem of the screen's width, and above it. */
const phoneOnly = 'hidden @max-[40rem]/calendar:flex';
const deskOnly = '@max-[40rem]/calendar:hidden';

function hrefOf(
  path: string,
  query: Readonly<Record<string, string>>,
  patch: Readonly<Record<string, string | null>>,
): string {
  const next = new URLSearchParams(query);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs === '' ? path : `${path}?${qs}`;
}

function shiftMonth(month: string, by: number): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1 + by, 1));
  return at.toISOString().slice(0, 7);
}

function Ready({
  data,
  path = `/time-off/calendar/${data.view}`,
  query = {},
  onNavigate,
  onFilter,
  onSubscribe,
  onSuggest,
  onDecide,
}: TeamCalendarProps & { readonly data: TeamCalendarData }): JSX.Element {
  const go = (patch: Readonly<Record<string, string | null>>): void => {
    onNavigate?.(hrefOf(path, query, patch));
  };
  const shown = (query['types'] ?? '').split(',').filter(Boolean);
  const holidays = query['holidays'] ?? '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(query['day'] ?? '') ? (query['day'] ?? null) : null;
  // The types and holiday calendars asked for, applied to what Time Off sent.
  const view =
    data.calendar === null
      ? null
      : {
          ...data.calendar,
          entries: data.calendar.entries.filter(
            (e) =>
              shown.length === 0 || (e.leaveTypeKey !== null && shown.includes(e.leaveTypeKey)),
          ),
          holidays: data.calendar.holidays.filter(
            (h) => holidays === '' || (holidays !== 'none' && h.locationKey === holidays),
          ),
        };
  const teams = [
    ...new Map(
      (data.calendar?.people ?? [])
        .filter((p) => p.teamKey !== null)
        .map((p) => [p.teamKey ?? '', p.teamName ?? p.teamKey ?? '']),
    ),
  ];
  const locations = [...new Set((data.calendar?.holidays ?? []).map((h) => h.locationKey))];
  const first = `${data.month}-01`;
  const last = addDays(`${shiftMonth(data.month, 1)}-01`, -1);
  const weekEnd = addDays(data.week, 4);
  const present = data.types.filter((t) =>
    data.calendar?.entries.some((e) => e.leaveTypeKey === t.key),
  );
  const selectDay = (date: string): void => {
    onFilter?.({ day: date });
  };
  const closeDay = (): void => {
    onFilter?.({ day: null });
  };
  const detail =
    view === null || day === null ? undefined : (
      <DayDetail view={view} types={data.types} date={day} />
    );

  return (
    <>
      {/* Where, and which way: a month at a desk, a week on a phone, a year. */}
      <div className="flex flex-wrap items-center gap-2">
        {data.view === 'year' ? (
          <>
            <Button
              size="sm"
              onClick={() => {
                go({ year: null });
              }}
            >
              This year
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Previous year"
              startIcon={<icons.previous aria-hidden />}
              onClick={() => {
                go({ year: String(data.year - 1) });
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label="Next year"
              startIcon={<icons.next aria-hidden />}
              onClick={() => {
                go({ year: String(data.year + 1) });
              }}
            />
            <h2 className="text-lg font-bold">{data.year}</h2>
          </>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => {
                go({ month: null, week: null });
              }}
            >
              Today
            </Button>
            <span className={`gap-1 ${deskOnly} flex`}>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Previous month"
                startIcon={<icons.previous aria-hidden />}
                onClick={() => {
                  go({ month: shiftMonth(data.month, -1), week: null });
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Next month"
                startIcon={<icons.next aria-hidden />}
                onClick={() => {
                  go({ month: shiftMonth(data.month, 1), week: null });
                }}
              />
            </span>
            <span className={`gap-1 ${phoneOnly}`}>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Previous week"
                startIcon={<icons.previous aria-hidden />}
                onClick={() => {
                  const week = addDays(data.week, -7);
                  go({ week, month: addDays(week, 4).slice(0, 7) });
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Next week"
                startIcon={<icons.next aria-hidden />}
                onClick={() => {
                  const week = addDays(data.week, 7);
                  go({ week, month: week.slice(0, 7) });
                }}
              />
            </span>
            <h2 className={`text-lg font-bold ${deskOnly}`}>{monthName(data.month)}</h2>
            <h2 className={`text-lg font-bold ${phoneOnly}`}>{spanLabel(data.week, weekEnd)}</h2>
          </>
        )}
        <span className="flex-1" />
        <Subscribe scope={data.scope} onSubscribe={onSubscribe} />
      </div>

      {/* Who: the team, the company or me, and which team. */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label="Whose time off"
          size="sm"
          value={data.scope}
          onValueChange={(scope) => {
            go({ scope: scope === 'team' ? null : scope, team: null, request: null });
          }}
        >
          <SegmentedControlItem value="team">Team</SegmentedControlItem>
          <SegmentedControlItem value="company">Company</SegmentedControlItem>
          <SegmentedControlItem value="me">Me</SegmentedControlItem>
        </SegmentedControl>
        {teams.length > 1 || data.teamKey !== null ? (
          <Select
            value={data.scope === 'team' ? (data.teamKey ?? teams[0]?.[0] ?? '') : 'all'}
            onValueChange={(team) => {
              go(
                team === 'all'
                  ? { scope: 'company', team: null }
                  : { scope: null, team, request: null },
              );
            }}
          >
            <SelectTrigger size="sm" aria-label="Team" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {teams.map(([key, name]) => (
                <SelectItem key={key} value={key}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {locations.length === 0 ? null : (
          <Select
            value={holidays === '' ? 'all' : holidays}
            onValueChange={(value) => onFilter?.({ holidays: value === 'all' ? null : value })}
          >
            <SelectTrigger size="sm" aria-label="Holidays" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Holidays: everywhere</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l} value={l}>
                  {`Holidays: ${placeName(l)}`}
                </SelectItem>
              ))}
              <SelectItem value="none">No holidays</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {data.view === 'year' ? (
        <CalendarHeatmap
          label={`Days off across ${String(data.year)}`}
          from={`${String(data.year)}-01-01`}
          to={`${String(data.year)}-12-31`}
          data={(data.days ?? []).map((d) => ({ date: d.date, value: d.off }))}
          describe={(value) => `${String(value)} ${value === 1 ? 'person' : 'people'} off`}
          summary={`How many people are off each day in ${String(data.year)}.`}
        />
      ) : view === null ? null : (
        <>
          {/* A desk: the month as a grid, or as a timeline beside a clash. */}
          <div className={`flex-col gap-4 ${deskOnly} flex`}>
            {data.view === 'month' ? (
              <Scheduler
                view="month"
                label={monthName(data.month)}
                columns={calendarColumns(view, first, last)}
                events={monthEvents(view, data.types, first, last)}
                today={data.today}
                {...(day === null ? {} : { selected: day })}
                onSelect={selectDay}
                {...(detail === undefined ? {} : { detail })}
                onDismiss={closeDay}
              />
            ) : data.clash === null ? (
              <TeamTimeline
                view={view}
                types={data.types}
                from={first}
                to={last}
                today={data.today}
                label={monthName(data.month)}
              />
            ) : (
              <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start gap-4">
                <TeamTimeline
                  view={view}
                  types={data.types}
                  {...clashRange(data.clash, first, last)}
                  today={data.today}
                  highlight={data.clash.member.personId}
                  label={monthName(data.month)}
                />
                <ClashCard data={data.clash} onSuggest={onSuggest} onDecide={onDecide} />
              </div>
            )}
          </div>
          {/* A phone: one working week, a tapped day as a sheet. */}
          <div className={`flex-col gap-4 ${phoneOnly}`}>
            <TeamTimeline
              view={view}
              types={data.types}
              from={data.week}
              to={weekEnd}
              today={data.today}
              label={`The week of ${spanLabel(data.week, weekEnd)}`}
              {...(day === null ? {} : { selected: day })}
              onSelect={selectDay}
              {...(detail === undefined ? {} : { detail })}
              onDismiss={closeDay}
            />
            {data.clash === null || data.view !== 'timeline' ? null : (
              <ClashCard data={data.clash} onSuggest={onSuggest} onDecide={onDecide} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {present.length === 0 ? null : (
              <ChartLegend
                items={present.map((t) => ({
                  label: t.name,
                  tone: lookOf(data.types, t.key).tone,
                }))}
                hidden={
                  shown.length === 0
                    ? []
                    : present.filter((t) => !shown.includes(t.key)).map((t) => t.name)
                }
                onHiddenChange={(hidden) => {
                  const keys = present.filter((t) => !hidden.includes(t.name)).map((t) => t.key);
                  onFilter?.({ types: keys.length === present.length ? null : keys.join(',') });
                }}
              />
            )}
            <p className="text-xs text-fg-subtle">
              Outlined and striped: waiting for approval. Weekends and holidays are shaded.
            </p>
          </div>
        </>
      )}
    </>
  );
}

/**
 * A chip on each working day someone is off: the month draws an event on
 * every day it covers, and nobody is away on a weekend.
 */
function monthEvents(
  view: CalendarView,
  types: readonly LeaveTypeLook[],
  first: string,
  last: string,
): SchedulerEvent[] {
  const names = new Map(view.people.map((p) => [p.personId, firstName(p.displayName)]));
  return view.entries.flatMap((e) => {
    const look = lookOf(types, e.leaveTypeKey);
    const waiting = tentative(e.status);
    return datesIn(e.span.from < first ? first : e.span.from, e.span.to > last ? last : e.span.to)
      .filter((d) => !isWeekend(d))
      .map((d) => ({
        id: `${e.requestId}:${d}`,
        column: d,
        start: 0,
        end: 0,
        allDay: true,
        title: names.get(e.personId) ?? '',
        detail: waiting ? `${look.name}, waiting for approval` : look.name,
        tone: look.tone,
        ...(waiting ? { tentative: true } : {}),
      }));
  });
}

/** The timeline beside a clash: from the Monday a week before it, twenty days, inside the month. */
function clashRange(clash: DecisionData, first: string, last: string): Range {
  const day = clash.belowMinimum[0]?.date ?? clash.request.span.from;
  const from = addDays(mondayOf(day), -7);
  const to = addDays(from, 19);
  return { from: from < first ? first : from, to: to > last ? last : to };
}

/** "madrid" as "Madrid": a location's key is all Time Off sends. ponytail: its name, when the view carries one. */
const placeName = (key: string): string =>
  key
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/* ----------------------------------------------------------- one day -- */

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' | 'info' }> =
  {
    approved: { label: 'Approved', tone: 'success' },
    taken: { label: 'Taken', tone: 'neutral' },
    pending: { label: 'Waiting', tone: 'warning' },
    change_pending: { label: 'Change waiting', tone: 'warning' },
    counter_proposed: { label: 'New dates suggested', tone: 'info' },
  };

/** Who is off on one day (T14, MT14): the type as the viewer may see it, and whether approved. */
export function DayDetail({
  view,
  types,
  date,
}: {
  readonly view: CalendarView;
  readonly types: readonly LeaveTypeLook[];
  readonly date: string;
}): JSX.Element {
  const off = view.entries.filter((e) => e.span.from <= date && date <= e.span.to);
  const cover = view.coverage.find((c) => c.date === date);
  const holidays = view.holidays.filter((h) => h.date === date);
  const name = (personId: string): string =>
    view.people.find((p) => p.personId === personId)?.displayName ?? '';
  const review = off.find((e) => tentative(e.status));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <p className="flex-1 font-display text-lg font-bold">{longDate(date)}</p>
        {cover === undefined || !cover.checked ? null : (
          <Badge size="sm" tone={cover.below ? 'danger' : 'neutral'}>
            {cover.below ? <icons.warning aria-hidden /> : null}
            {`${String(cover.in)} of ${String(cover.of)} in`}
          </Badge>
        )}
      </div>
      {off.length === 0 && holidays.length === 0 ? (
        <p className="text-sm text-fg-muted">Nobody is off.</p>
      ) : (
        <List>
          {holidays.map((h) => (
            <ListItem
              key={`${h.locationKey}:${h.name}`}
              icon={<icons.flagged />}
              iconTone="neutral"
              description={`Public holiday · ${placeName(h.locationKey)}`}
            >
              {h.name}
            </ListItem>
          ))}
          {off.map((e) => {
            const look = lookOf(types, e.leaveTypeKey);
            const status = STATUS[e.status] ?? { label: e.status, tone: 'neutral' as const };
            return (
              <ListItem
                key={e.requestId}
                leading={<Avatar name={name(e.personId)} />}
                description={`${look.name} · ${spanLabel(e.span.from, e.span.to)}`}
                trailing={
                  <Badge size="sm" tone={status.tone} dot>
                    {status.label}
                  </Badge>
                }
              >
                {name(e.personId)}
              </ListItem>
            );
          })}
        </List>
      )}
      {off.some((e) => e.leaveTypeKey === null) ? (
        <p className="text-xs text-fg-subtle">
          Some time off shows as “Off”: its type stays with the person’s manager and HR.
        </p>
      ) : null}
      {review === undefined ? null : (
        <Button variant="primary" size="sm" asChild>
          <a href={`/time-off/approvals/waiting/${review.requestId}`}>
            {`Review ${firstName(name(review.personId))}’s request`}
          </a>
        </Button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- subscribe -- */

/** Subscribe (§10.1): a signed feed address for this scope, issued when asked for. */
function Subscribe({
  scope,
  onSubscribe,
}: {
  readonly scope: Scope;
  readonly onSubscribe: TeamCalendarProps['onSubscribe'];
}): JSX.Element {
  const [answer, setAnswer] = useState<
    { ok: true; url: string } | { ok: false; message: string } | null
  >(null);
  const [pending, start] = useTransition();
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open || onSubscribe === undefined || answer?.ok === true) return;
        start(async () => {
          setAnswer(await onSubscribe(scope));
        });
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          startIcon={<icons.calendar aria-hidden />}
          disabled={onSubscribe === undefined}
        >
          Subscribe
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-96 flex-col gap-3">
        <p className="text-sm font-semibold">Add to your calendar app</p>
        {answer === null || pending ? (
          <Skeleton className="h-10 rounded-md" />
        ) : answer.ok ? (
          <CopyField label="Feed address" value={answer.url} mono size="sm" />
        ) : (
          <Alert tone="danger" title="No feed address">
            {answer.message}
          </Alert>
        )}
        <p className="text-xs text-fg-muted">
          It shows what you see here and nothing more. Anyone with the address sees it too, so keep
          it to yourself.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/* ----------------------------------------------------------- skeleton -- */

/** The calendar while it loads, in the view's shape: the bars of controls, then the grid. */
export function TeamCalendarSkeleton({ view }: { readonly view: CalendarViewName }): JSX.Element {
  return (
    <div className="@container/calendar flex flex-col gap-4">
      <PageHeader title="Calendar" />
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">Loading the calendar</span>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-8 w-40" />
          <span className="flex-1" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-56 rounded-full" />
          <Skeleton className="h-8 w-44 rounded-md" />
        </div>
        <Skeleton
          className={
            view === 'month'
              ? 'h-[50rem] rounded-lg @max-[40rem]/calendar:h-[26rem]'
              : view === 'timeline'
                ? 'h-[26rem] rounded-lg'
                : 'h-48 rounded-lg'
          }
        />
      </div>
    </div>
  );
}
