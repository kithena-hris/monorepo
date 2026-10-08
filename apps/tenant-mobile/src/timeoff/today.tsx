import {
  Alert,
  AssistantMark,
  Badge,
  Button,
  Card,
  Carousel,
  Icon,
  List,
  ListItem,
  Progress,
  RangeBar,
  SegmentedControl,
  SegmentedControlItem,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Stack,
  Stat,
  Text,
  type RangeBarSegment,
} from '@reach/ui-native';
import { Coffee, MapPin, PartyPopper, Play, Square } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { askTimeOff } from './api';
import { leaveIcon } from './icons';
import { clockTime, duration, localDate, minuteOfDay, partOfDay, stopwatch } from './time';
import { amount, bridgeDays, longDate, relativeDay, shortDate, spanLabel, statusOf } from './words';

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
  const { act, busy } = useAct('timeoff');
  const { state, today } = clock;
  const [where, setWhere] = useState<WorkModel>(clock.workModel ?? 'office');
  const [closing, setClosing] = useState(false);
  const worked = today.workedMinutes ?? 0;
  const left = Math.max(0, today.plannedMinutes - worked);
  const first = today.segments.find((s) => s.kind !== 'planned' && s.kind !== 'missing');
  const minute = minuteOfDay(now, zone);
  const punch = (kind: PunchKind, model: WorkModel = clock.workModel ?? where): void => {
    void act('PunchTimeOffClock', { input: { kind, workModel: model, source: 'mobile' } }).then(
      (done) => {
        if (done !== null) onPunched();
      },
    );
  };
  const sub =
    state === 'in'
      ? `Since ${clockTime(first?.from ?? 0)} · ${duration(left)} to go`
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
          {clock.workModel === null || state === 'out' ? null : (
            <Badge size="sm" icon={MapPin}>
              {WHERE[clock.workModel]}
            </Badge>
          )}
        </View>
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Timer worked={worked} running={state === 'in'} since={now} />
            <Text variant="footnote" tone="muted">
              {sub}
            </Text>
          </View>
          {state === 'in' ? (
            <>
              <Button
                startIcon={<Icon icon={Coffee} />}
                accessibilityLabel="Start break"
                loading={busy !== null}
                onPress={() => {
                  punch('break_start');
                }}
              />
              <Button
                variant="primary"
                startIcon={<Icon icon={Square} />}
                accessibilityLabel="Clock out"
                onPress={() => {
                  setClosing(true);
                }}
              />
            </>
          ) : state === 'on_break' ? (
            <Button
              variant="primary"
              startIcon={<Icon icon={Play} />}
              loading={busy !== null}
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
              loading={busy !== null}
              onPress={() => {
                punch('in', where);
              }}
            >
              {`Clock in · ${WHERE[where]}`}
            </Button>
          </>
        ) : null}
      </Stack>
      {closing ? (
        <Sheet
          open
          onOpenChange={(o) => {
            if (!o) setClosing(false);
          }}
        >
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{`Clock out at ${clockTime(minute)}?`}</SheetTitle>
            </SheetHeader>
            <SheetBody>
              {dayBar(today.segments, minute)}
              <View className="flex-row gap-2">
                <Stat className="flex-1" label="Worked" value={duration(worked)} />
                <Stat className="flex-1" label="Break" value={duration(today.breakMinutes)} />
                <Stat
                  className="flex-1"
                  label="Overtime"
                  value={duration(Math.max(0, worked - today.plannedMinutes))}
                />
              </View>
            </SheetBody>
            <SheetFooter stack>
              <Button
                variant="primary"
                fullWidth
                startIcon={<Icon icon={Square} />}
                loading={busy !== null}
                onPress={() => {
                  setClosing(false);
                  punch('out');
                }}
              >
                Clock out
              </Button>
              <Button
                variant="ghost"
                fullWidth
                onPress={() => {
                  setClosing(false);
                }}
              >
                Keep working
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : null}
    </Card>
  );
}

/**
 * The Time off tab (design MT1): today first — the live clock with break
 * and clock-out in thumb reach, balances as a row to swipe, one suggestion
 * at a time, and what is coming up.
 */
export function TimeOffHome({ navigation }: PeopleScreen<'TimeOff'>): React.JSX.Element {
  const signed = useSigned();
  const [data, setData] = useState<{
    overview: Overview;
    holidays: readonly Holiday[];
    now: number;
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const now = Date.now();
    const year = new Date(now).getUTCFullYear();
    const [overview, thisYear, nextYear] = await Promise.all([
      askTimeOff<Overview>(signed, 'TimeOffOverview'),
      askTimeOff<{ holidays: Holiday[] }>(signed, 'TimeOffHolidays', { year }),
      askTimeOff<{ holidays: Holiday[] }>(signed, 'TimeOffHolidays', { year: year + 1 }),
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
    });
  };
  useEffect(() => {
    void load();
    return navigation.addListener('focus', () => {
      void load();
    });
  }, [navigation, signed]);

  if (failed !== null) {
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
  const { overview, holidays, now } = data;
  const zone = overview.member?.timeZone ?? 'UTC';
  const today = localDate(now, zone);
  const tracked = overview.balances.find((b) => b.unit === 'day' && b.yearly !== null);
  const bridge = overview.bridges[0];
  const ahead = holidays.filter((h) => h.date >= today).slice(0, 2);
  return (
    <Page large="Time off">
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
      {bridge === undefined || tracked === undefined ? null : (
        <Card>
          <Stack gap={2}>
            <View className="flex-row items-center gap-2">
              <AssistantMark size={20} />
              <Text variant="headline" className="flex-1">
                {`${String(bridge.used)} ${bridge.used === 1 ? 'day gets' : 'days get'} you ${String(bridge.away.days)} off`}
              </Text>
              {bridge.text.ai ? <Badge size="sm">AI</Badge> : null}
            </View>
            <Text variant="subhead">{bridge.text.text}</Text>
            <Button
              size="sm"
              onPress={() => {
                navigation.navigate('TimeOffRequest', {
                  leaveTypeKey: tracked.leaveTypeKey,
                  from: bridge.from,
                  to: bridge.to,
                });
              }}
            >
              {`Request ${bridgeDays(bridge)}`}
            </Button>
          </Stack>
        </Card>
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
    </Page>
  );
}
