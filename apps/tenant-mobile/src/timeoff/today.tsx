import {
  Alert,
  AssistantMark,
  Badge,
  Button,
  Card,
  Carousel,
  SearchField,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  List,
  ListItem,
  Progress,
  RangeBar,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Stat,
  Text,
  type RangeBarSegment,
} from '@reach/ui-native';
import {
  Baby,
  CalendarDays,
  ChartColumn,
  CheckCheck,
  Clock3,
  Coffee,
  ListChecks,
  MapPin,
  PartyPopper,
  Play,
  Plus,
  QrCode,
  Settings,
  Square,
  Timer as TimerIcon,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import { keptAnswer, read, useSigned, type Signed } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { useTimeOff } from './api';
import { SuggestionCard, type Described, type Option } from './describe';
import { leaveIcon } from './icons';
import { clockTime, duration, localDate, minuteOfDay, partOfDay, stopwatch } from './time';
import { amount, longDate, relativeDay, shortDate, spanLabel, statusOf } from './words';

type ClockState = 'out' | 'in' | 'on_break';
type WorkModel = 'office' | 'remote' | 'client';
type PunchKind = 'in' | 'out' | 'break_start' | 'break_end';

export interface Balance {
  readonly leaveTypeKey: string;
  readonly name: string;
  readonly unit: 'day' | 'hour';
  readonly colorToken: string;
  readonly icon: string;
  readonly left: string;
  readonly used: string;
  readonly booked: string;
  readonly allowance: string;
  readonly yearly: string | null;
}

interface Span {
  readonly from: string;
  readonly to: string;
  readonly startsHalfDay: boolean;
  readonly endsHalfDay: boolean;
}

export interface Bridge {
  readonly from: string;
  readonly to: string;
  readonly used: number;
  readonly away: { readonly from: string; readonly to: string; readonly days: number };
  readonly holidays: readonly { readonly date: string; readonly name: string }[];
  readonly text: { readonly text: string; readonly ai: boolean };
}

interface Overview {
  readonly member: {
    readonly personId: string;
    readonly displayName: string;
    readonly firstName: string;
    readonly teamName: string | null;
    readonly timeZone: string;
  } | null;
  readonly clock: {
    readonly state: ClockState;
    readonly workModel: WorkModel | null;
    readonly today: {
      readonly date: string;
      readonly workedMinutes: number | null;
      readonly breakMinutes: number;
      readonly overtimeMinutes: number | null;
      readonly plannedMinutes: number;
      readonly segments: readonly {
        readonly kind: string;
        readonly from: number;
        readonly to: number;
      }[];
    };
  } | null;
  readonly balances: readonly Balance[];
  readonly comingUp: readonly {
    readonly requestId: string;
    readonly leaveTypeKey: string;
    readonly leaveTypeName: string;
    readonly status: string;
    readonly span: Span;
    readonly workingDays: string;
    readonly waitingOn: 'manager' | 'hr' | null;
  }[];
  readonly bridges: readonly Bridge[];
}

interface Holiday {
  readonly date: string;
  readonly name: string;
  readonly layer: string;
}

interface Viewer {
  readonly approves: boolean;
  readonly hrAdmin: boolean;
  readonly member: boolean;
  readonly counts: { readonly attendanceExceptions: number; readonly requestsWaiting: number };
}

/** A punch as shown before Time Off has answered it. */
interface Punched {
  readonly state: ClockState;
  readonly workModel: WorkModel;
  /** Minutes worked when it was pressed. */
  readonly worked: number;
  /** When it was pressed, which the timer counts on from. */
  readonly since: number;
}

const STATE: Record<ClockState, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  in: { label: 'Clocked in', tone: 'success' },
  on_break: { label: 'On a break', tone: 'warning' },
  out: { label: 'Not clocked in', tone: 'neutral' },
};
const WHERE: Record<WorkModel, string> = {
  office: 'Office',
  remote: 'Remote',
  client: 'At a client',
};
const SEGMENT: Record<string, Omit<RangeBarSegment, 'start' | 'end'>> = {
  worked: { label: 'Worked', tone: 'success' },
  live: { label: 'Working now', tone: 'success', pattern: 'hatched' },
  break: { label: 'Break', tone: 'warning', size: 'thin' },
  overtime: { label: 'Overtime', tone: 'chart-4' },
  missing: { label: 'Missing', tone: 'danger', pattern: 'hatched' },
  planned: { label: 'Planned', tone: 'neutral' },
};
/** 07:00 to 19:00, in minutes after midnight, as the design's day bar. */
const DAY: readonly [number, number] = [420, 1140];

/** Time worked today, ticking each second while clocked in, from when the page was read. */
function Timer({
  worked,
  running,
  since,
}: {
  worked: number;
  running: boolean;
  since: number;
}): React.JSX.Element {
  const [at, setAt] = useState(since);
  useEffect(() => {
    if (!running) return undefined;
    setAt(Date.now());
    const timer = setInterval(() => {
      setAt(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [running]);
  const seconds = worked * 60 + (running ? Math.max(0, Math.floor((at - since) / 1000)) : 0);
  return (
    <Text variant="title1" weight="bold" className="tabular-nums" accessibilityRole="timer">
      {stopwatch(seconds)}
    </Text>
  );
}

function dayBar(
  segments: readonly { kind: string; from: number; to: number }[],
  now: number | undefined,
) {
  return (
    <RangeBar
      label="Today"
      domain={DAY}
      ticks={[420, 600, 780, 960, 1140]}
      format={clockTime}
      {...(now === undefined ? {} : { now })}
      segments={segments.map((s) => ({
        start: s.from,
        end: s.to,
        ...(SEGMENT[s.kind] ?? { label: s.kind }),
      }))}
    />
  );
}

/**
 * The clock (design MT1, MT3, MT4): the live time worked, the day as a bar,
 * and break and clock-out in thumb reach. Clocking in says where the day is
 * worked; clocking out shows the day before it is confirmed.
 */
function ClockCard({
  clock,
  now,
  zone,
  onPunched,
}: {
  clock: NonNullable<Overview['clock']>;
  now: number;
  zone: string;
  onPunched: () => void;
}): React.JSX.Element {
  const { act } = useAct('timeoff');
  const { today } = clock;
  const [where, setWhere] = useState<WorkModel>(clock.workModel ?? 'office');
  const [closing, setClosing] = useState<number | null>(null);
  // A punch shows at once, before Time Off has it; the next answer replaces it,
  // and a refusal puts the clock back as it was.
  const [mine, setMine] = useState<Punched | null>(null);
  useEffect(() => {
    setMine(null);
  }, [clock]);
  const state = mine?.state ?? clock.state;
  const workModel = mine?.workModel ?? clock.workModel;
  const worked = mine?.worked ?? today.workedMinutes ?? 0;
  const since = mine?.since ?? now;
  const left = Math.max(0, today.plannedMinutes - worked);
  const first = today.segments.find((s) => s.kind !== 'planned' && s.kind !== 'missing');
  const minute = minuteOfDay(since, zone);
  const workedBy = (at: number): number => worked + (state === 'in' ? (at - since) / 60_000 : 0);
  const punch = (kind: PunchKind, model: WorkModel = workModel ?? where): void => {
    const at = Date.now();
    setMine({
      state:
        kind === 'in' || kind === 'break_end' ? 'in' : kind === 'break_start' ? 'on_break' : 'out',
      workModel: model,
      worked: workedBy(at),
      since: at,
    });
    void act('PunchTimeOffClock', { input: { kind, workModel: model, source: 'mobile' } }).then(
      (done) => {
        if (done === null) setMine(null);
        else onPunched();
      },
    );
  };
  const sub =
    state === 'in'
      ? `Since ${clockTime(first?.from ?? minute)} · ${duration(left)} to go`
      : state === 'on_break'
        ? `${duration(worked)} worked of ${duration(today.plannedMinutes)}`
        : worked > 0
          ? `${duration(worked)} worked today`
          : today.plannedMinutes > 0
            ? `Your day is ${duration(today.plannedMinutes)}`
            : 'Not a working day';
  return (
    <Card>
      <Stack gap={3}>
        <View className="flex-row items-center gap-2">
          <Badge size="sm" tone={STATE[state].tone} dot>
            {STATE[state].label}
          </Badge>
          {workModel === null || state === 'out' ? null : (
            <Badge size="sm" icon={MapPin}>
              {WHERE[workModel]}
            </Badge>
          )}
        </View>
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Timer worked={worked} running={state === 'in'} since={since} />
            <Text variant="footnote" tone="muted">
              {sub}
            </Text>
          </View>
          {state === 'in' ? (
            <>
              <Button
                startIcon={<Icon icon={Coffee} />}
                accessibilityLabel="Start break"
                onPress={() => {
                  punch('break_start');
                }}
              />
              <Button
                variant="primary"
                startIcon={<Icon icon={Square} />}
                accessibilityLabel="Clock out"
                onPress={() => {
                  setClosing(Date.now());
                }}
              />
            </>
          ) : state === 'on_break' ? (
            <Button
              variant="primary"
              startIcon={<Icon icon={Play} />}
              onPress={() => {
                punch('break_end');
              }}
            >
              End break
            </Button>
          ) : null}
        </View>
        {dayBar(today.segments, minute)}
        {state === 'out' ? (
          <>
            <SegmentedControl
              fullWidth
              value={where}
              accessibilityLabel="Where you are working"
              onValueChange={(v) => {
                setWhere(v as WorkModel);
              }}
            >
              <SegmentedControlItem value="office">Office</SegmentedControlItem>
              <SegmentedControlItem value="remote">Remote</SegmentedControlItem>
              <SegmentedControlItem value="client">Client</SegmentedControlItem>
            </SegmentedControl>
            {/* ponytail: a button, not the design's slide; a slide-to-confirm belongs in Reach first. */}
            <Button
              variant="primary"
              fullWidth
              startIcon={<Icon icon={Play} />}
              onPress={() => {
                punch('in', where);
              }}
            >
              {`Clock in · ${WHERE[where]}`}
            </Button>
          </>
        ) : null}
      </Stack>
      {closing === null ? null : (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setClosing(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{`Clock out at ${clockTime(minuteOfDay(closing, zone))}?`}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              {dayBar(today.segments, minuteOfDay(closing, zone))}
              <View className="flex-row gap-2">
                <Stat className="flex-1" label="Worked" value={duration(workedBy(closing))} />
                <Stat className="flex-1" label="Break" value={duration(today.breakMinutes)} />
                <Stat
                  className="flex-1"
                  label="Overtime"
                  value={duration(Math.max(0, workedBy(closing) - today.plannedMinutes))}
                />
              </View>
            </DialogBody>
            <DialogFooter stack>
              <Button
                variant="primary"
                fullWidth
                startIcon={<Icon icon={Square} />}
                onPress={() => {
                  setClosing(null);
                  punch('out');
                }}
              >
                Clock out
              </Button>
              <Button
                variant="ghost"
                fullWidth
                onPress={() => {
                  setClosing(null);
                }}
              >
                Keep working
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

interface Home {
  readonly overview: Overview;
  readonly holidays: readonly Holiday[];
  /** When the overview was read: the clock counts on from it. */
  readonly now: number;
  readonly viewer: Viewer | null;
}

/** What the tab reads, asked ahead at sign-in so it opens on it. */
export const homeReads = (
  year: number,
): readonly (readonly [string, Record<string, unknown>])[] => [
  ['TimeOffOverview', {}],
  ['TimeOffHolidays', { year }],
  ['TimeOffHolidays', { year: year + 1 }],
  ['TimeOffViewer', {}],
  ['TimeOffDescribe', {}],
];

/** The tab as last read, if it was. */
function keptHome(signed: Signed): Home | null {
  const year = new Date().getUTCFullYear();
  const overview = keptAnswer<Overview>(signed, 'TimeOffOverview', {}, 'timeoff');
  if (overview === undefined) return null;
  const holidays = (y: number) =>
    keptAnswer<{ holidays: Holiday[] }>(signed, 'TimeOffHolidays', { year: y }, 'timeoff')?.data
      .holidays ?? [];
  return {
    overview: overview.data,
    holidays: [...holidays(year), ...holidays(year + 1)],
    now: overview.at,
    viewer: keptAnswer<Viewer>(signed, 'TimeOffViewer', {}, 'timeoff')?.data ?? null,
  };
}

/**
 * Kithena's suggestions, there as the tab opens rather than behind a button:
 * the dates Time Off ranks best for this person, worded by the assistant,
 * each one tap from a request or handed to the planner with it. Typing what
 * you want goes straight to the planner. Until the ranking answers, the
 * overview's best bridge stands in.
 */
function Suggestions({
  navigation,
  fallback,
}: {
  navigation: PeopleScreen<'TimeOff'>['navigation'];
  fallback: { bridge: Bridge; leaveTypeKey: string } | null;
}): React.JSX.Element | null {
  const { load } = useTimeOff<Described>('TimeOffDescribe', {});
  const [typed, setTyped] = useState('');
  const ranked = load.status === 'ready' ? load.data : null;
  const leaveTypeKey = ranked?.understood.leaveTypeKey ?? fallback?.leaveTypeKey ?? null;
  const options: readonly Option[] =
    ranked?.options ??
    (fallback === null
      ? []
      : [
          {
            from: fallback.bridge.from,
            to: fallback.bridge.to,
            used: fallback.bridge.used,
            away: fallback.bridge.away,
            holidays: fallback.bridge.holidays,
            short: [],
            fewest: null,
            fits: true,
            leftAfter: null,
            line: fallback.bridge.text,
          },
        ]);
  const choose = (o: Option): void => {
    navigation.navigate('TimeOffRequest', {
      ...(leaveTypeKey === null ? {} : { leaveTypeKey }),
      from: o.from,
      to: o.to,
    });
  };
  const plan = (sentence?: string): void => {
    navigation.navigate('TimeOffDescribe', sentence === undefined ? undefined : { sentence });
  };
  return (
    <Stack gap={2}>
      <View className="flex-row items-center gap-2 px-1">
        <AssistantMark size={18} />
        <Text variant="footnote" weight="semibold" tone="muted" className="flex-1">
          Kithena suggests
        </Text>
        <Button
          size="sm"
          variant="link"
          onPress={() => {
            plan();
          }}
        >
          More
        </Button>
      </View>
      <SearchField
        value={typed}
        onValueChange={setTyped}
        onSearch={(value) => {
          if (value.trim() !== '') plan(value.trim());
        }}
        placeholder="A long weekend in December…"
        label="Describe the time off you want"
      />
      {options.length === 0 ? null : (
        <Carousel accessibilityLabel="Suggested dates" controls="none" slideWidth={0.88}>
          {options.slice(0, 5).map((o, i) => (
            <SuggestionCard
              key={`${o.from}${o.to}`}
              option={o}
              best={ranked !== null && i === 0}
              onChoose={() => {
                choose(o);
              }}
              onMore={() => {
                plan(`${String(o.away.days)} days off around ${spanLabel(o.from, o.to)}`);
              }}
            />
          ))}
        </Carousel>
      )}
    </Stack>
  );
}

/**
 * The Time off tab (design MT1): today first — the live clock with break
 * and clock-out in thumb reach, balances as a row to swipe, one suggestion
 * at a time, and what is coming up.
 */
export function TimeOffHome({ navigation }: PeopleScreen<'TimeOff'>): React.JSX.Element {
  const signed = useSigned();
  const [data, setData] = useState<Home | null>(() => keptHome(signed));
  const [failed, setFailed] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const now = Date.now();
    const year = new Date(now).getUTCFullYear();
    const [overview, thisYear, nextYear, viewer] = await Promise.all([
      read<Overview>(signed, 'TimeOffOverview', {}, 'timeoff'),
      read<{ holidays: Holiday[] }>(signed, 'TimeOffHolidays', { year }, 'timeoff'),
      read<{ holidays: Holiday[] }>(signed, 'TimeOffHolidays', { year: year + 1 }, 'timeoff'),
      read<Viewer>(signed, 'TimeOffViewer', {}, 'timeoff'),
    ]);
    if (!overview.ok) {
      setFailed(overview.message);
      return;
    }
    setFailed(null);
    setData({
      overview: overview.data,
      holidays: [
        ...(thisYear.ok ? thisYear.data.holidays : []),
        ...(nextYear.ok ? nextYear.data.holidays : []),
      ],
      now,
      viewer: viewer.ok ? viewer.data : null,
    });
  };
  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => {
      void load();
    });
    // `load` reads only `signed`.
  }, [navigation, signed]);

  // What was already showing stays; only an empty screen says it failed.
  if (failed !== null && data === null) {
    return (
      <Page large="Time off">
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  }
  if (data === null) {
    return (
      <Page large="Time off">
        <Loading label="Loading your time off" />
      </Page>
    );
  }
  const { overview, holidays, now, viewer } = data;
  const go = (row: {
    label: string;
    line: string;
    icon: typeof Coffee;
    count?: number;
    open: () => void;
  }) => (
    <ListItem
      key={row.label}
      icon={row.icon}
      description={row.line}
      {...(row.count === undefined || row.count === 0
        ? { chevron: true }
        : {
            trailing: (
              <Badge size="sm" tone="danger" variant="solid">
                {String(row.count)}
              </Badge>
            ),
          })}
      onPress={row.open}
    >
      {row.label}
    </ListItem>
  );
  const zone = overview.member?.timeZone ?? 'UTC';
  const today = localDate(now, zone);
  const tracked = overview.balances.find((b) => b.unit === 'day' && b.yearly !== null);
  const bridge = overview.bridges[0];
  const ahead = holidays.filter((h) => h.date >= today).slice(0, 2);
  return (
    <Page
      large="Time off"
      trailing={
        <Button
          size="sm"
          variant="ghost"
          startIcon={<Icon icon={Plus} />}
          accessibilityLabel="Request time off"
          onPress={() => {
            navigation.navigate('TimeOffRequest');
          }}
        />
      }
    >
      {overview.member === null ? (
        <Alert tone="info" title="Nothing here for you yet">
          Time Off does not have you as an employee yet, so there are no balances to show or time
          off to request. There will be once HR hires you in People.
        </Alert>
      ) : (
        <Text tone="muted">{`Good ${partOfDay(now, zone)}, ${overview.member.firstName} · ${longDate(today)}`}</Text>
      )}
      {overview.clock === null ? null : (
        <ClockCard clock={overview.clock} now={now} zone={zone} onPunched={() => void load()} />
      )}
      {overview.balances.length === 0 ? null : (
        <Carousel accessibilityLabel="Your balances" controls="none" slideWidth={0.64}>
          {overview.balances.map((b) => {
            const hours = b.unit === 'hour';
            return (
              <Pressable
                key={b.leaveTypeKey}
                accessibilityRole="button"
                accessibilityLabel={`${b.name}: where the days went`}
                onPress={() => {
                  navigation.navigate('TimeOffBalance', {
                    leaveTypeKey: b.leaveTypeKey,
                    name: b.name,
                  });
                }}
              >
                <Stat
                  label={b.name}
                  icon={<Icon icon={leaveIcon(b.icon)} />}
                  value={hours ? `${amount(b.left)}h` : amount(b.left)}
                  unit={hours ? 'banked' : 'days left'}
                  {...(b.yearly === null
                    ? {}
                    : {
                        chart: (
                          <Progress
                            label={`${b.name}: ${amount(b.used)} used, ${amount(b.booked)} booked`}
                            value={Number(b.used) + Number(b.booked)}
                            max={Number(b.yearly)}
                          />
                        ),
                        description: `${amount(b.used)} used · ${amount(b.booked)} booked`,
                      })}
                />
              </Pressable>
            );
          })}
        </Carousel>
      )}
      {overview.member === null ? null : (
        <Suggestions
          navigation={navigation}
          fallback={
            bridge === undefined || tracked === undefined
              ? null
              : { bridge, leaveTypeKey: tracked.leaveTypeKey }
          }
        />
      )}
      <View className="flex-row items-center px-1">
        <Text variant="footnote" weight="semibold" tone="muted" className="flex-1">
          Coming up
        </Text>
        <Button
          size="sm"
          variant="link"
          onPress={() => {
            navigation.navigate('TimeOffRequests');
          }}
        >
          All
        </Button>
      </View>
      {ahead.length === 0 && overview.comingUp.length === 0 ? (
        <Text tone="muted" className="px-1">
          Nothing booked yet.
        </Text>
      ) : (
        <List>
          {ahead.map((h) => (
            <ListItem
              key={h.date}
              icon={PartyPopper}
              description={`${shortDate(h.date)} · holiday · ${relativeDay(today, h.date)}`}
              chevron
              onPress={() => {
                navigation.navigate('TimeOffHolidays');
              }}
            >
              {h.name}
            </ListItem>
          ))}
          {overview.comingUp.map((r) => {
            const type = overview.balances.find((b) => b.leaveTypeKey === r.leaveTypeKey);
            const status = statusOf(r.status);
            return (
              <ListItem
                key={r.requestId}
                icon={leaveIcon(type?.icon)}
                description={
                  r.waitingOn === 'manager'
                    ? 'Waiting for your manager'
                    : r.waitingOn === 'hr'
                      ? 'Waiting for HR'
                      : `${amount(r.workingDays)} ${amount(r.workingDays) === '1' ? 'day' : 'days'}`
                }
                trailing={
                  <Badge size="sm" tone={status.tone} dot>
                    {status.label}
                  </Badge>
                }
                onPress={() => {
                  navigation.navigate('TimeOffRequestDetail', { requestId: r.requestId });
                }}
              >
                {`${r.leaveTypeName} · ${spanLabel(r.span.from, r.span.to)}`}
              </ListItem>
            );
          })}
        </List>
      )}
      <List>
        {[
          go({
            label: 'Calendar',
            line: 'Who is off this week',
            icon: CalendarDays,
            open: () => {
              navigation.navigate('TimeOffCalendar');
            },
          }),
          ...(overview.member === null
            ? []
            : [
                go({
                  label: 'Your requests',
                  line: 'Coming up, past and cancelled',
                  icon: ListChecks,
                  open: () => {
                    navigation.navigate('TimeOffRequests');
                  },
                }),
                go({
                  label: 'Timesheet',
                  line: 'Your week, worked against planned',
                  icon: Clock3,
                  open: () => {
                    navigation.navigate('TimeOffTimesheet');
                  },
                }),
                go({
                  label: 'Parental leave',
                  line: 'Plan it, then send it to HR',
                  icon: Baby,
                  open: () => {
                    navigation.navigate('TimeOffParental');
                  },
                }),
                go({
                  label: 'My kiosk code',
                  line: 'Clock in at the door',
                  icon: QrCode,
                  open: () => {
                    navigation.navigate('TimeOffKioskCode');
                  },
                }),
              ]),
          ...(viewer?.approves === true
            ? [
                go({
                  label: 'Time off to approve',
                  line: 'Clear to approve and look closer',
                  icon: CheckCheck,
                  count: viewer.counts.requestsWaiting,
                  open: () => {
                    navigation.navigate('TimeOffApprovals');
                  },
                }),
                go({
                  label: 'Team right now',
                  line: 'Who is in, on a break or away',
                  icon: Users,
                  open: () => {
                    navigation.navigate('TimeOffTeamNow');
                  },
                }),
                go({
                  label: 'Overtime and corrections',
                  line: 'To decide, and your own',
                  icon: TimerIcon,
                  open: () => {
                    navigation.navigate('TimeOffAttendanceRequests');
                  },
                }),
              ]
            : [
                go({
                  label: 'Your overtime',
                  line: 'How each day was decided',
                  icon: TimerIcon,
                  open: () => {
                    navigation.navigate('TimeOffAttendanceRequests');
                  },
                }),
              ]),
          ...(viewer?.hrAdmin === true
            ? [
                go({
                  label: 'Exceptions',
                  line: 'Missing clock-outs, short rests, long days',
                  icon: TriangleAlert,
                  count: viewer.counts.attendanceExceptions,
                  open: () => {
                    navigation.navigate('TimeOffExceptions');
                  },
                }),
                go({
                  label: 'Pay period',
                  line: 'What goes to payroll, and closing the month',
                  icon: Wallet,
                  open: () => {
                    navigation.navigate('TimeOffPayPeriod');
                  },
                }),
                go({
                  label: 'Parental leave plans',
                  line: 'Plans sent to HR',
                  icon: Baby,
                  open: () => {
                    navigation.navigate('TimeOffParentalCases');
                  },
                }),
                go({
                  label: 'Insights',
                  line: 'Absence, balances and nudges',
                  icon: ChartColumn,
                  open: () => {
                    navigation.navigate('TimeOffInsights');
                  },
                }),
                go({
                  label: 'Time off settings',
                  line: 'Leave types, policies, approvals, holidays',
                  icon: Settings,
                  open: () => {
                    navigation.navigate('TimeOffSettings');
                  },
                }),
              ]
            : []),
        ]}
      </List>
    </Page>
  );
}
