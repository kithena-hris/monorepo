import {
  Alert,
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Card,
  DayTiles,
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
  ChartColumn,
  CheckCheck,
  Clock3,
  Coffee,
  Flag,
  ListChecks,
  Play,
  Plus,
  QrCode,
  Scale,
  Send,
  Square,
  Timer as TimerIcon,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { useInbox } from '../inbox/api';
import { tasksOf } from '../inbox/brief';
import { TaskCard } from '../inbox/task-card';
import { useAct } from '../people/act';
import { keptAnswer, read, useSigned, type Signed } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { useTimeOff } from './api';
import { BalanceDialog, type Balance } from './balance';
import { DayDialog, mondayOf, type CalendarAnswer } from './calendar';
import { DescribedCard, useDescribed } from './describe-answer';
import { leaveIcon } from './icons';
import { approversOf, RequestDialog } from './request-dialog';
import { ChangeOrCancel } from './requests';
import { clockTime, duration, localDate, minuteOfDay, stopwatch, todayHere } from './time';
import { addDays, amount, asDate, longDate, shortDate, spanLabel, statusOf } from './words';

type ClockState = 'out' | 'in' | 'on_break';
type WorkModel = 'office' | 'remote' | 'client';
type PunchKind = 'in' | 'out' | 'break_start' | 'break_end';


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
    <Text variant="title2" weight="bold" className="tabular-nums" accessibilityRole="timer">
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
      ? `In since ${clockTime(first?.from ?? minute)} · ${duration(left)} to go`
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
        {/* Compact (v3 T1): the time worked, since when and where, and the two buttons. */}
        <View className="flex-row items-center gap-3">
          <View
            accessibilityLabel={STATE[state].label}
            className={
              state === 'in'
                ? 'size-2.5 rounded-full bg-success'
                : state === 'on_break'
                  ? 'size-2.5 rounded-full bg-warning'
                  : 'size-2.5 rounded-full bg-fg-subtle'
            }
          />
          <View className="flex-1">
            <Timer worked={worked} running={state === 'in'} since={since} />
            <Text variant="footnote" tone="muted">
              {workModel === null || state === 'out' ? sub : `${sub} · ${WHERE[workModel]}`}
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
                onPress={() => {
                  setClosing(Date.now());
                }}
              >
                Clock out
              </Button>
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

/** One balance the tab leads with (T1): the number, the bar, and Details for the ledger. */
function BalanceCard({
  main,
  others,
  onDetails,
}: {
  main: Balance;
  others: readonly Balance[];
  onDetails: (b: Balance) => void;
}): React.JSX.Element {
  const hours = main.unit === 'hour';
  return (
    <Card padded={false} className="overflow-hidden">
      <View className="gap-3 p-4">
        <View className="flex-row items-center gap-2.5">
          <View className="size-9 items-center justify-center rounded-[11px] bg-accent-subtle">
            <Icon icon={leaveIcon(main.icon)} size={17} tone="accent" />
          </View>
          <Text variant="headline" className="flex-1">
            {main.name}
          </Text>
          <Button
            size="xs"
            variant="link"
            onPress={() => {
              onDetails(main);
            }}
          >
            Details
          </Button>
        </View>
        <View className="flex-row items-baseline gap-2">
          <Text className="text-[52px] font-bold leading-[54px] tracking-[-0.04em] tabular-nums">
            {amount(main.left)}
          </Text>
          <Text tone="muted">
            {hours
              ? 'hours banked'
              : main.yearly === null
                ? 'days left'
                : `days left of ${amount(main.yearly)}`}
          </Text>
        </View>
        {main.yearly === null ? null : (
          <>
            <Progress
              label={`${amount(main.used)} used, ${amount(main.booked)} booked`}
              value={Number(main.used) + Number(main.booked)}
              max={Number(main.yearly)}
            />
            <Text variant="footnote" tone="muted">
              {`${amount(main.used)} used · ${amount(main.booked)} booked · ${amount(main.left)} left`}
            </Text>
          </>
        )}
      </View>
      {others.length === 0 ? null : (
        <View className="flex-row border-t border-border">
          {others.slice(0, 3).map((b, i) => (
            <Pressable
              key={b.leaveTypeKey}
              accessibilityRole="button"
              accessibilityLabel={`${b.name}: where it went`}
              onPress={() => {
                onDetails(b);
              }}
              className={i > 0 ? 'flex-1 gap-1 border-l border-border p-3' : 'flex-1 gap-1 p-3'}
            >
              <Text variant="footnote" tone="muted" numberOfLines={1}>
                {b.name}
              </Text>
              <Text weight="semibold">
                {b.unit === 'hour'
                  ? `${amount(b.left)}h banked`
                  : b.yearly === null && Number(b.left) === 0
                    ? 'No limit'
                    : `${amount(b.left)} left`}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });

/**
 * The Time off tab (design v3 T1, T2, T8): everything in one scroll and no
 * sub-pages to find it. The clock, the balance with Details, a box to
 * describe what you want that answers in place, what waits for a manager,
 * what is coming up (each opens change or cancel), who is off this week
 * (each day opens who and why), the bigger plans, and the holidays.
 */
export function TimeOffHome({ navigation }: PeopleScreen<'TimeOff'>): React.JSX.Element {
  const signed = useSigned();
  const [data, setData] = useState<Home | null>(() => keptHome(signed));
  const [failed, setFailed] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [sentence, setSentence] = useState<string | null>(null);
  const described = useDescribed(sentence);
  const [open, setOpen] = useState<
    | { kind: 'request'; from?: string; to?: string; leaveTypeKey?: string }
    | { kind: 'balance'; leaveTypeKey: string; name: string }
    | { kind: 'change'; requestId: string; left: string | null }
    | { kind: 'day'; date: string }
    | null
  >(null);
  const { inbox } = useInbox();
  const panel = useTimeOff<{ leaveTypes: { key: string; name: string; colorToken: string }[] }>(
    'TimeOffRequestPanel',
    {},
  ).load;
  // HR's count beside Balance adjustments: what waits for them to decide.
  const adjustments = useTimeOff<{ items: { canDecide: boolean }[] }>('TimeOffBalanceAdjustments');
  useFocusEffect(adjustments.reload);
  const adjustmentsWaiting =
    adjustments.load.status === 'ready'
      ? adjustments.load.data.items.filter((a) => a.canDecide).length
      : 0;
  const todayDate = todayHere();
  const week = mondayOf(todayDate);
  const team = useTimeOff<CalendarAnswer>('TimeOffCalendarTimeline', {
    scope: 'team',
    from: week,
    to: addDays(week, 4),
  });

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
      team.reload();
    });
    // `load` reads only `signed`.
  }, [navigation, signed]);

  const request = (
    <Button
      size="sm"
      variant="primary"
      startIcon={<Icon icon={Plus} tone="on-accent" />}
      onPress={() => {
        setOpen({ kind: 'request' });
      }}
    >
      Request
    </Button>
  );

  // What was already showing stays; only an empty screen says it failed.
  if (failed !== null && data === null) {
    return (
      <Page large="Time off" trailing={request}>
        <Failed message={failed} onRetry={() => void load()} />
      </Page>
    );
  }
  if (data === null) {
    return (
      <Page large="Time off" trailing={request}>
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
              <Badge size="sm" tone="warning">
                {`${String(row.count)} to look at`}
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
  const city = (zone.split('/').at(-1) ?? zone).replaceAll('_', ' ');
  const main = overview.balances.find((b) => b.unit === 'day' && b.yearly !== null) ?? overview.balances[0];
  const others = overview.balances.filter((b) => b !== main);
  const ahead = holidays.filter((h) => h.date >= today).slice(0, 3);
  const approvals = (inbox === null ? [] : tasksOf(inbox)).filter((t) => t.kind === 'timeoff.approval');
  const answer = described.answer;
  const typeOf = (key: string | null) =>
    panel.status === 'ready' ? panel.data.leaveTypes.find((t) => t.key === key) : undefined;
  const days =
    team.load.status !== 'ready'
      ? []
      : [0, 1, 2, 3, 4].map((n) => {
          const date = addDays(week, n);
          const c = team.load.status === 'ready' ? team.load.data.coverage.find((x) => x.date === date) : undefined;
          const answerNow = team.load.status === 'ready' ? team.load.data : null;
          const out = (answerNow?.entries ?? [])
            .filter((e) => e.span.from <= date && date <= e.span.to)
            .map((e) => answerNow?.people.find((p) => p.personId === e.personId)?.displayName ?? 'Someone');
          const holiday = answerNow?.holidays.find((h) => h.date === date);
          return {
            id: date,
            label: WEEKDAY.format(asDate(date)),
            value: c === undefined ? (holiday === undefined ? '–' : '·') : String(c.in),
            today: date === todayDate,
            attention: c?.below === true,
            accessibilityLabel: `${longDate(date)}: ${c === undefined ? 'no count' : `${String(c.in)} of ${String(c.of)} in`}${c?.below === true ? ', below the minimum' : ''}`,
            footer:
              holiday !== undefined
                ? 'Holiday'
                : out.length === 0
                  ? 'All in'
                  : (
                      <AvatarGroup size={22} max={2}>
                        {out.map((n) => (
                          <Avatar key={n} name={n} decorative />
                        ))}
                      </AvatarGroup>
                    ),
          };
        });

  return (
    <Page
      large="Time off"
      trailing={request}
      {...(answer !== null && answer.preview !== null
        ? {
            foot: (
              <>
                <Button
                  className="flex-1"
                  onPress={() => {
                    setOpen({
                      kind: 'request',
                      ...(answer.preview === null ? {} : { from: answer.preview.span.from, to: answer.preview.span.to }),
                      ...(answer.described?.understood.leaveTypeKey == null
                        ? {}
                        : { leaveTypeKey: answer.described.understood.leaveTypeKey }),
                    });
                  }}
                >
                  Change
                </Button>
                <Button
                  className="flex-1"
                  variant="primary"
                  startIcon={<Icon icon={Send} tone="on-accent" />}
                  loading={described.sending}
                  onPress={() => {
                    void described.send().then((id) => {
                      if (id === null) return;
                      setSentence(null);
                      setTyped('');
                      void load();
                    });
                  }}
                >
                  {approversOf(answer.preview) === null ? 'Send' : `Send to ${approversOf(answer.preview) ?? ''}`}
                </Button>
              </>
            ),
          }
        : {})}
    >
      {open?.kind === 'request' ? (
        <RequestDialog
          initial={open}
          onClose={() => {
            setOpen(null);
          }}
          onSent={() => {
            setOpen(null);
            setSentence(null);
            setTyped('');
            void load();
          }}
        />
      ) : null}
      {open?.kind === 'balance' ? (
        <BalanceDialog
          leaveTypeKey={open.leaveTypeKey}
          name={open.name}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
      {open?.kind === 'change' ? (
        <ChangeOrCancel
          requestId={open.requestId}
          left={open.left}
          onClose={() => {
            setOpen(null);
          }}
          onDone={() => {
            setOpen(null);
            void load();
          }}
        />
      ) : null}
      {open?.kind === 'day' ? (
        <DayDialog
          date={open.date}
          scope="team"
          seed={team.load.status === 'ready' ? team.load.data : null}
          typeOf={typeOf}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}

      {overview.member === null ? (
        <Alert tone="info" title="Nothing here for you yet">
          Time Off does not have you as an employee yet, so there are no balances to show or time
          off to request. There will be once HR hires you in People.
        </Alert>
      ) : null}

      {approvals.length === 0 || inbox === null ? null : (
        <>
          <Alert tone="accent" variant="summary">
            {`${approvals.length === 1 ? 'One request waits' : `${String(approvals.length)} requests wait`} for you.${
              approvals.some(
                (a) => ((a.detail as { alreadyOut?: { out: number } | null } | null)?.alreadyOut?.out ?? 0) > 0,
              )
                ? ' Others are out the same week, so check the team first.'
                : ' Nobody else is out those weeks.'
            }`}
          </Alert>
          <Heading title="Waiting for you" />
          {approvals.map((item) => (
            <TaskCard key={item.id} item={item} now={inbox.now} zone={inbox.zone} navigation={navigation} />
          ))}
        </>
      )}

      {overview.clock === null ? null : (
        <ClockCard clock={overview.clock} now={now} zone={zone} onPunched={() => void load()} />
      )}
      {main === undefined ? null : (
        <BalanceCard
          main={main}
          others={others}
          onDetails={(b) => {
            setOpen({ kind: 'balance', leaveTypeKey: b.leaveTypeKey, name: b.name });
          }}
        />
      )}
      {overview.member === null ? null : (
        <SearchField
          ask
          value={typed}
          onValueChange={(text) => {
            setTyped(text);
            if (text.trim() === '') setSentence(null);
          }}
          onSearch={(value) => {
            setSentence(value.trim() === '' ? null : value.trim());
          }}
          placeholder="Describe it: “Friday and the Monday after”"
          label="Describe the time off you want"
        />
      )}
      {answer === null ? null : (
        <DescribedCard answer={answer} note={described.note} onNote={described.setNote} />
      )}

      <Heading
        title="Coming up"
        action="All"
        onAction={() => {
          navigation.navigate('TimeOffRequests');
        }}
      />
      {overview.comingUp.length === 0 ? (
        <Text tone="muted" className="px-1">
          Nothing booked yet.
        </Text>
      ) : (
        <List>
          {overview.comingUp.map((r) => {
            const type = overview.balances.find((b) => b.leaveTypeKey === r.leaveTypeKey);
            const status = statusOf(r.status);
            return (
              <ListItem
                key={r.requestId}
                icon={leaveIcon(type?.icon)}
                description={`${r.leaveTypeName} · ${amount(r.workingDays)} ${amount(r.workingDays) === '1' ? 'day' : 'days'}`}
                trailing={
                  <Badge size="sm" tone={status.tone} dot>
                    {r.waitingOn === 'manager'
                      ? 'With your manager'
                      : r.waitingOn === 'hr'
                        ? 'With HR'
                        : status.label}
                  </Badge>
                }
                onPress={() => {
                  setOpen({ kind: 'change', requestId: r.requestId, left: type?.left ?? null });
                }}
              >
                {spanLabel(r.span.from, r.span.to)}
              </ListItem>
            );
          })}
        </List>
      )}

      {days.length === 0 ? null : (
        <>
          <Heading
            title="Team this week"
            action="Calendar"
            onAction={() => {
              navigation.navigate('TimeOffCalendar');
            }}
          />
          <DayTiles
            days={days}
            onPress={(date) => {
              setOpen({ kind: 'day', date });
            }}
          />
        </>
      )}

      <Heading title="More" />
      <List>
        {[
          ...(overview.member === null
            ? []
            : [
                go({
                  label: 'Plan parental leave',
                  line: 'Kithena drafts the plan from the law where you work',
                  icon: Baby,
                  open: () => {
                    navigation.navigate('TimeOffParental');
                  },
                }),
                go({
                  label: 'My timesheet',
                  line: 'Your week, worked against planned',
                  icon: Clock3,
                  open: () => {
                    navigation.navigate('TimeOffTimesheet');
                  },
                }),
                go({
                  label: 'Your requests',
                  line: 'Coming up, past and cancelled',
                  icon: ListChecks,
                  open: () => {
                    navigation.navigate('TimeOffRequests');
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
                ...(viewer.hrAdmin
                  ? []
                  : [
                      go({
                        label: 'Balance adjustments',
                        line: 'Add or take away days, saying why; HR approves',
                        icon: Scale,
                        open: () => {
                          navigation.navigate('TimeOffAdjustments');
                        },
                      }),
                    ]),
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
                  label: 'Balance adjustments',
                  line: 'Waiting for you, and the last 30 days',
                  icon: Scale,
                  count: adjustmentsWaiting,
                  open: () => {
                    navigation.navigate('TimeOffAdjustments');
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
              ]
            : []),
        ]}
      </List>

      {ahead.length === 0 ? null : (
        <>
          <Heading
            title={`Holidays in ${city}`}
            action="All"
            onAction={() => {
              navigation.navigate('TimeOffHolidays');
            }}
          />
          <List>
            {ahead.map((h) => (
              <ListItem key={h.date} icon={Flag} description={h.name}>
                {`${WEEKDAY.format(asDate(h.date))} ${shortDate(h.date)}`}
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Page>
  );
}
