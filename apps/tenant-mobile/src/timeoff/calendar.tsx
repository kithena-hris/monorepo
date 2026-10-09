import {
  Avatar,
  Badge,
  Button,
  Calendar,
  CalendarHeatmap,
  Chip,
  CopyField,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  List,
  ListItem,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  TimelineChart,
  type CalendarMarker,
  type TimelineRow,
} from '@reach/ui-native';
import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import { readAhead, useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { calendarFeed, useTimeOff } from './api';
import { todayHere } from './time';
import { addDays, asDate, longDate, nextWorkingDay, spanLabel, statusOf } from './words';

type Scope = 'team' | 'company' | 'me';
type View_ = 'week' | 'month' | 'year';

interface Entry {
  readonly personId: string;
  readonly leaveTypeKey: string | null;
  readonly requestId: string | null;
  readonly status: string;
  readonly span: { from: string; to: string; startsHalfDay: boolean; endsHalfDay: boolean };
}

interface CalendarAnswer {
  readonly entries: readonly Entry[];
  readonly people: readonly { personId: string; displayName: string; teamName: string | null }[];
  readonly coverage: readonly {
    date: string;
    in: number;
    of: number;
    required: number;
    below: boolean;
  }[];
  readonly holidays: readonly { date: string; name: string }[];
}

interface LeaveType {
  readonly key: string;
  readonly name: string;
  readonly colorToken: string;
}

/** The Monday of the week a date is in. */
function mondayOf(date: string): string {
  const day = asDate(date).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

const TONE: Record<
  string,
  'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'chart-6' | 'neutral'
> = {
  'chart-1': 'chart-1',
  'chart-2': 'chart-2',
  'chart-3': 'chart-3',
  'chart-4': 'chart-4',
  'chart-5': 'chart-5',
  'chart-6': 'chart-6',
};

/** The calendar's first screen, every scope of it: asked ahead so a scope opens at once. */
export const calendarReads = (
  today: string,
): readonly (readonly [string, Record<string, unknown>])[] => {
  const week = mondayOf(today);
  return [
    ...(['team', 'company', 'me'] as const).map(
      (scope) => ['TimeOffCalendarTimeline', { scope, from: week, to: addDays(week, 4) }] as const,
    ),
    ['TimeOffCalendarYear', { scope: 'team', year: Number(today.slice(0, 4)) }],
    ['TimeOffRequestPanel', {}],
  ];
};

/**
 * Who's off (design MT13, MT14): a week fits on the screen, people as rows
 * and five days as columns with a count of who's in under each; tapping a day
 * opens who is off that day. The team, the company or yourself; a month or
 * the year from the filters; and the calendar as a feed for a calendar app.
 */
export function TimeOffCalendar({
  navigation,
}: PeopleScreen<'TimeOffCalendar'>): React.JSX.Element {
  const today = todayHere();
  const [scope, setScope] = useState<Scope>('team');
  const [view, setView] = useState<View_>('week');
  const [week, setWeek] = useState(mondayOf(today));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [day, setDay] = useState<string | null>(null);
  const [filters, setFilters] = useState(false);
  const range =
    view === 'week'
      ? { from: week, to: addDays(week, 4) }
      : {
          from: `${month}-01`,
          to: addDays(
            `${month.slice(0, 4)}-${String(Number(month.slice(5)) + 1).padStart(2, '0')}-01`,
            -1,
          ),
        };
  const timeline = useTimeOff<CalendarAnswer>('TimeOffCalendarTimeline', { scope, ...range });
  // The weeks either side and the other scopes, so the arrows and the switch never wait.
  const signed = useSigned();
  useEffect(() => {
    if (view !== 'week') return;
    readAhead(
      signed,
      [
        ...(['team', 'company', 'me'] as const).map(
          (s) =>
            ['TimeOffCalendarTimeline', { scope: s, from: week, to: addDays(week, 4) }] as const,
        ),
        ...[-7, 7].map(
          (by) =>
            [
              'TimeOffCalendarTimeline',
              { scope, from: addDays(week, by), to: addDays(week, by + 4) },
            ] as const,
        ),
      ],
      'timeoff',
    );
  }, [signed, scope, view, week]);
  const yearly = useTimeOff<{ days: { date: string; off: number }[] }>('TimeOffCalendarYear', {
    scope,
    year,
  });
  const types = useTimeOff<{ leaveTypes: LeaveType[] }>('TimeOffRequestPanel');
  const typeOf = (key: string | null): LeaveType | undefined =>
    types.load.status === 'ready'
      ? types.load.data.leaveTypes.find((t) => t.key === key)
      : undefined;

  const load = view === 'year' ? yearly.load : timeline.load;
  const reload = view === 'year' ? yearly.reload : timeline.reload;
  const days = Array.from({ length: 5 }, (_, i) => addDays(week, i));
  const dayLabel = (d: string): string =>
    new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
      .format(asDate(d))
      .replace(',', '');

  return (
    <Page
      title="Calendar"
      back={{ label: 'Time off', onPress: navigation.goBack }}
      trailing={
        <Button
          size="sm"
          variant="ghost"
          startIcon={<Icon icon={SlidersHorizontal} />}
          accessibilityLabel="View and subscribe"
          onPress={() => {
            setFilters(true);
          }}
        />
      }
    >
      <SegmentedControl
        fullWidth
        value={scope}
        accessibilityLabel="Whose calendar"
        onValueChange={(v) => {
          setScope(v === 'company' ? 'company' : v === 'me' ? 'me' : 'team');
        }}
      >
        <SegmentedControlItem value="team">Team</SegmentedControlItem>
        <SegmentedControlItem value="company">Company</SegmentedControlItem>
        <SegmentedControlItem value="me">Me</SegmentedControlItem>
      </SegmentedControl>
      <View className="flex-row items-center gap-2">
        <Text variant="title3" className="flex-1">
          {view === 'week'
            ? spanLabel(week, addDays(week, 4))
            : view === 'month'
              ? new Intl.DateTimeFormat('en-GB', {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                }).format(asDate(`${month}-01`))
              : String(year)}
        </Text>
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronLeft} />}
          accessibilityLabel="Earlier"
          onPress={() => {
            if (view === 'week') setWeek(addDays(week, -7));
            else if (view === 'month') setMonth(addDays(`${month}-01`, -1).slice(0, 7));
            else setYear(year - 1);
          }}
        />
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronRight} />}
          accessibilityLabel="Later"
          onPress={() => {
            if (view === 'week') setWeek(addDays(week, 7));
            else if (view === 'month') setMonth(addDays(`${month}-28`, 7).slice(0, 7));
            else setYear(year + 1);
          }}
        />
      </View>
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label="Loading the calendar" />
      ) : view === 'year' && yearly.load.status === 'ready' ? (
        <ScrollView horizontal>
          <CalendarHeatmap
            label={`Days off in ${String(year)}`}
            from={`${String(year)}-01-01`}
            to={`${String(year)}-12-31`}
            data={yearly.load.data.days.map((d) => ({ date: d.date, value: d.off }))}
            describe={(value, date) => `${String(value)} off on ${longDate(date)}`}
          />
        </ScrollView>
      ) : timeline.load.status === 'ready' ? (
        view === 'week' ? (
          <>
            <TimelineChart
              label="Who is off this week"
              domain={{ start: week, end: addDays(week, 4) }}
              unit="day"
              today={today}
              shadeWeekends={false}
              labelWidth={96}
              rows={timeline.load.data.people.map((p): TimelineRow => ({
                label: p.displayName,
                leading: <Avatar name={p.displayName} size={24} />,
                items: (timeline.load.status === 'ready' ? timeline.load.data.entries : [])
                  .filter((e) => e.personId === p.personId)
                  .map((e) => ({
                    id: `${e.personId}:${e.span.from}`,
                    label: typeOf(e.leaveTypeKey)?.name ?? 'Off',
                    start: e.span.from,
                    end: e.span.to,
                    tone: TONE[typeOf(e.leaveTypeKey)?.colorToken ?? ''] ?? 'neutral',
                    tentative: e.status === 'pending',
                  })),
              }))}
            />
            <View className="flex-row flex-wrap gap-2">
              {days.map((d) => {
                const c =
                  timeline.load.status === 'ready'
                    ? timeline.load.data.coverage.find((x) => x.date === d)
                    : undefined;
                return (
                  <Chip
                    key={d}
                    onPress={() => {
                      setDay(d);
                    }}
                  >
                    {c === undefined
                      ? dayLabel(d)
                      : `${dayLabel(d)} · ${String(c.in)} of ${String(c.of)} in`}
                  </Chip>
                );
              })}
            </View>
            <Text variant="footnote" tone="muted">
              An outlined bar is still waiting for approval. Tap a day to see who is off.
            </Text>
          </>
        ) : (
          <Calendar
            label="Who is off this month"
            today={today}
            month={`${month}-01`}
            onMonthChange={(m) => {
              setMonth(m.slice(0, 7));
            }}
            markers={Object.fromEntries(
              timeline.load.data.coverage
                .filter((c) => c.of - c.in > 0)
                .map((c): [string, CalendarMarker] => [
                  c.date,
                  { tone: c.below ? 'danger' : 'info', label: `${String(c.of - c.in)} off` },
                ]),
            )}
            onSelect={(d) => {
              if (d !== null) setDay(d);
            }}
          />
        )
      ) : null}
      {day === null ? null : (
        <DayDialog
          date={day}
          scope={scope}
          seed={timeline.load.status === 'ready' ? timeline.load.data : null}
          typeOf={typeOf}
          onClose={() => {
            setDay(null);
          }}
        />
      )}
      {filters ? (
        <CalendarOptions
          view={view}
          scope={scope}
          onView={(v) => {
            setView(v);
            setFilters(false);
          }}
          onClose={() => {
            setFilters(false);
          }}
        />
      ) : null}
    </Page>
  );
}

/** One day (MT14): who is in, and who is off and why, as much as the viewer may see. */
function DayDialog({
  date,
  scope,
  seed,
  typeOf,
  onClose,
}: {
  date: string;
  scope: Scope;
  /** The week or month on screen, which already holds the day: shown until the day's own answer. */
  seed: CalendarAnswer | null;
  typeOf: (key: string | null) => LeaveType | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const { load } = useTimeOff<CalendarAnswer>('TimeOffCalendarDay', { date, scope });
  const data =
    load.status === 'ready'
      ? load.data
      : seed === null
        ? null
        : {
            ...seed,
            entries: seed.entries.filter((e) => e.span.from <= date && date <= e.span.to),
          };
  const coverage = data?.coverage.find((c) => c.date === date);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <View className="flex-row items-center gap-2">
            <DialogTitle className="flex-1 text-left">{longDate(date)}</DialogTitle>
            {coverage === undefined ? null : (
              <Badge size="sm" tone={coverage.below ? 'danger' : 'neutral'}>
                {`${String(coverage.in)} of ${String(coverage.of)} in`}
              </Badge>
            )}
          </View>
        </DialogHeader>
        <DialogBody>
          {data === null ? (
            <Loading label="Loading the day" />
          ) : data.entries.length === 0 ? (
            <Text tone="muted">Nobody is off.</Text>
          ) : (
            <List>
              {data.entries.map((e) => {
                const who =
                  data.people.find((p) => p.personId === e.personId)?.displayName ?? 'Someone';
                const status = statusOf(e.status);
                return (
                  <ListItem
                    key={`${e.personId}${e.span.from}`}
                    leading={<Avatar name={who} size={36} />}
                    description={`${typeOf(e.leaveTypeKey)?.name ?? 'Off'} · back ${new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(asDate(nextWorkingDay(e.span.to)))}`}
                    trailing={
                      <Badge size="sm" tone={e.status === 'pending' ? 'warning' : 'neutral'}>
                        {e.status === 'pending' ? status.label : 'Off'}
                      </Badge>
                    }
                  >
                    {who}
                  </ListItem>
                );
              })}
            </List>
          )}
          <Text variant="footnote" tone="muted">
            Teammates only see “Off” for sick days. Types and reasons stay with managers and HR.
          </Text>
        </DialogBody>
        <DialogFooter>
          <Button onPress={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The view, and the calendar as a feed for a calendar app, or every feed stopped. */
function CalendarOptions({
  view,
  scope,
  onView,
  onClose,
}: {
  view: View_;
  scope: Scope;
  onView: (view: View_) => void;
  onClose: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct('timeoff');
  const [feed, setFeed] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Calendar</DialogTitle>
          <DialogDescription>How to see it, and where else it shows up.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <SegmentedControl
            fullWidth
            value={view}
            accessibilityLabel="View"
            onValueChange={(v) => {
              onView(v as View_);
            }}
          >
            <SegmentedControlItem value="week">Week</SegmentedControlItem>
            <SegmentedControlItem value="month">Month</SegmentedControlItem>
            <SegmentedControlItem value="year">Year</SegmentedControlItem>
          </SegmentedControl>
          {feed === null ? (
            <Button
              loading={asking}
              onPress={() => {
                setAsking(true);
                void calendarFeed(signed, scope).then((answer) => {
                  setAsking(false);
                  if (!answer.ok) return;
                  setFeed(answer.data.url);
                  void Linking.openURL(answer.data.url.replace(/^https?:/, 'webcal:'));
                });
              }}
            >
              {`Subscribe to ${scope === 'me' ? 'my' : scope === 'team' ? 'the team’s' : 'the company’s'} calendar`}
            </Button>
          ) : (
            <CopyField value={feed} label="Copy the feed address" mono />
          )}
          <Button
            variant="danger-soft"
            loading={busy === 'RevokeTimeOffCalendarFeeds'}
            onPress={() => {
              void act(
                'RevokeTimeOffCalendarFeeds',
                {},
                'Every feed you subscribed to has stopped',
              );
            }}
          >
            Stop every feed I subscribed to
          </Button>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
