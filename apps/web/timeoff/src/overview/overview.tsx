import {
  Alert,
  AssistantCard,
  Avatar,
  Badge,
  Button,
  Card,
  Carousel,
  List,
  ListItem,
  PageHeader,
  PageSection,
  Progress,
  RangeBar,
  Skeleton,
  Stat,
  icons,
  useCoarsePointerAt,
  type IconName,
  type RangeBarSegment,
} from '@reach/ui';
import {
  createElement,
  useEffect,
  useRef,
  useState,
  useTransition,
  type JSX,
  type ReactNode,
} from 'react';

import { ClockIn, ClockOutSheet } from '../clock/clock';
import { Loaded, type Loadable, type Outcome } from '../load';
import {
  amount,
  bridgeDays,
  chartTone,
  daysBetween,
  leaveIcon,
  longDate,
  nextWorkingDay,
  pad,
  shortDate,
  spanLabel,
  statusOf,
} from '../words';

/**
 * The overview (T1, MT1): the day and the year on one page. The live clock,
 * every balance, what is coming up, who on the team is away, and the days
 * that turn one day off into four.
 *
 * Drawn from what the shell hands it and nothing else: Time Off's overview,
 * the holidays where the person works and the bridge days the shell found in
 * them, and when the server asked (`now`). The clock's buttons are the
 * shell's (`onPunch`); a punch that goes through comes back as the page
 * drawn again.
 *
 * One component at two widths. Under 40rem of its own width it is MT1: the
 * title, the clock, the balances as a row to swipe, one suggestion and what
 * is coming up; the team and the second suggestion are the desk's.
 */

type ClockState = 'out' | 'in' | 'on_break';
type WorkModel = 'office' | 'remote' | 'client';
type PunchKind = 'in' | 'out' | 'break_start' | 'break_end';

interface Span {
  readonly from: string;
  readonly to: string;
  readonly startsHalfDay: boolean;
  readonly endsHalfDay: boolean;
}

export interface OverviewData {
  /** `null` for an HR account that is not itself a member. */
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
      readonly plannedMinutes: number;
      /** Minutes after the day's local midnight. */
      readonly segments: readonly {
        readonly kind: string;
        readonly from: number;
        readonly to: number;
      }[];
    };
  } | null;
  readonly balances: readonly {
    readonly leaveTypeKey: string;
    readonly name: string;
    readonly unit: 'day' | 'hour';
    readonly colorToken: string;
    readonly icon: string;
    /** Decimal strings, as Time Off sends them: "11.500". */
    readonly left: string;
    readonly used: string;
    readonly booked: string;
    readonly allowance: string;
    readonly yearly: string | null;
  }[];
  readonly comingUp: readonly {
    readonly requestId: string;
    readonly leaveTypeKey: string;
    readonly leaveTypeName: string;
    readonly status: string;
    readonly span: Span;
    readonly workingDays: string;
    readonly waitingOn: 'manager' | 'hr' | null;
  }[];
  readonly teamToday: readonly {
    readonly personId: string;
    readonly displayName: string;
    /** `null` when the viewer sees "Away" and nothing more. */
    readonly leaveTypeKey: string | null;
    readonly span: Span;
  }[];
  readonly holidays: readonly {
    readonly date: string;
    readonly name: string;
    readonly layer: string;
  }[];
  /** Time Off's best bridge days ahead (TOF-085), each with its line. */
  readonly bridges: readonly Bridge[];
  /** When the server asked, ISO: the clock's timer starts from it. */
  readonly now: string;
}

/** Working days that join a holiday to the days off around it, as Time Off found them. */
export interface Bridge {
  /** The days to ask for. */
  readonly from: string;
  readonly to: string;
  readonly used: number;
  readonly away: { readonly from: string; readonly to: string; readonly days: number };
  readonly holidays: readonly { readonly date: string; readonly name: string }[];
  /** `ai` when a model wrote it; a template otherwise. */
  readonly text: { readonly text: string; readonly ai: boolean };
}

export interface OverviewProps {
  readonly load: Loadable<OverviewData>;
  /**
   * Clock in, start or end a break, clock out; `mobile` when under a finger
   * (TOF-076). Absent, the clock has no buttons.
   */
  readonly onPunch?: (
    kind: PunchKind,
    workModel: WorkModel,
    source?: 'web' | 'mobile',
  ) => Promise<Outcome>;
}

export function Overview({ load, onPunch }: OverviewProps): JSX.Element {
  if (load.status === 'loading') return <OverviewSkeleton />;
  return (
    <div className="@container/overview flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Time off" /> : null}
      <Loaded load={load} what="your time off">
        {(data) => <Ready data={data} onPunch={onPunch} />}
      </Loaded>
    </div>
  );
}

/* ------------------------------------------------------------- layout -- */

/** The two columns, from the width a desk gives them; one below it. */
const body =
  'flex flex-col gap-5 @min-[64rem]/overview:grid @min-[64rem]/overview:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] @min-[64rem]/overview:items-start';
/** A column at a desk; under 40rem its parts join the page's one column, in MT1's order. */
const column = `flex min-w-0 flex-col gap-5 @max-[40rem]/overview:contents`;

function Ready({
  data,
  onPunch,
}: {
  readonly data: OverviewData;
  readonly onPunch: OverviewProps['onPunch'];
}): JSX.Element {
  const zone = data.member?.timeZone ?? 'UTC';
  const today = localDate(data.now, zone);
  const tracked = data.balances.find((b) => b.unit === 'day' && b.yearly !== null);
  return (
    <>
      <PageHeader
        title={
          data.member === null
            ? 'Time off'
            : `Good ${partOfDay(data.now, zone)}, ${data.member.firstName}`
        }
        description={[longDate(today), data.member?.teamName].filter(Boolean).join(' · ')}
        actions={
          <Button
            asChild
            startIcon={<icons.parental aria-hidden />}
            className={'@max-[40rem]/overview:hidden'}
          >
            <a href="/time-off/parental/plan">Plan parental leave</a>
          </Button>
        }
      />
      <div className={body}>
        <div className={column}>
          {data.clock === null ? null : (
            <ClockCard clock={data.clock} now={data.now} zone={zone} onPunch={onPunch} />
          )}
          <Balances balances={data.balances} />
          <ComingUp data={data} today={today} />
        </div>
        <div className={column}>
          {data.bridges.length === 0 || tracked === undefined ? null : (
            <Bridges bridges={data.bridges} left={amount(tracked.left)} type={tracked} />
          )}
          <TeamToday data={data} today={today} />
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- clock -- */

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

const SEGMENT: Record<string, Pick<RangeBarSegment, 'label' | 'tone' | 'pattern' | 'size'>> = {
  worked: { label: 'Worked', tone: 'success' },
  live: { label: 'Working now', tone: 'success', pattern: 'hatched' },
  break: { label: 'Break', tone: 'warning', size: 'thin' },
  overtime: { label: 'Overtime', tone: 'chart-4' },
  missing: { label: 'Missing', tone: 'danger', pattern: 'hatched' },
  planned: { label: 'Planned', tone: 'neutral' },
};

/** 07:00 to 19:00, in minutes after midnight, as the design's day bar. */
const DAY: readonly [number, number] = [420, 1140];

function ClockCard({
  clock,
  now,
  zone,
  onPunch,
}: {
  readonly clock: NonNullable<OverviewData['clock']>;
  readonly now: string;
  readonly zone: string;
  readonly onPunch: OverviewProps['onPunch'];
}): JSX.Element {
  const { state, today } = clock;
  const workModel = clock.workModel ?? 'office';
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  // Under a finger (TOF-076, MT3, MT4): clocking in is a slide, from where
  // you say you are, and clocking out shows the day first.
  const card = useRef<HTMLDivElement>(null);
  const coarse = useCoarsePointerAt(card);
  const [where, setWhere] = useState<WorkModel>(workModel);
  const [closing, setClosing] = useState(false);
  const press = (kind: PunchKind, model: WorkModel = workModel, mobile = false): void => {
    if (onPunch === undefined) return;
    setFailed(null);
    start(async () => {
      const outcome = await (mobile ? onPunch(kind, model, 'mobile') : onPunch(kind, model));
      if (!outcome.ok) setFailed(outcome.message);
    });
  };
  const action = (kind: PunchKind, label: string, icon: IconName, primary: boolean): ReactNode => (
    <Button
      key={kind}
      variant={primary ? 'primary' : 'secondary'}
      startIcon={createElement(icons[icon], { 'aria-hidden': true })}
      disabled={onPunch === undefined || pending}
      // Under a finger the slide below clocks in.
      className={kind === 'in' ? 'touch:hidden' : undefined}
      onClick={() => {
        if (kind === 'out' && coarse) setClosing(true);
        else press(kind);
      }}
    >
      {label}
    </Button>
  );
  const first = today.segments.find((s) => s.kind !== 'planned' && s.kind !== 'missing');
  const worked = today.workedMinutes ?? 0;
  const left = Math.max(0, today.plannedMinutes - worked);
  const sub =
    state === 'in'
      ? `Since ${clockTime(first?.from ?? 0)} · ${duration(left)} left of your ${duration(today.plannedMinutes)} day`
      : state === 'on_break'
        ? `${duration(worked)} worked of ${duration(today.plannedMinutes)}`
        : worked > 0
          ? `${duration(worked)} worked today`
          : today.plannedMinutes > 0
            ? `Your day is ${duration(today.plannedMinutes)}`
            : 'Not a working day';
  return (
    <Card padded className={`flex flex-col gap-4 @max-[40rem]/overview:order-1`}>
      <div className="flex items-center gap-3">
        <Badge tone={STATE[state].tone} pulse={state !== 'out'} dot={state === 'out'}>
          {STATE[state].label}
        </Badge>
        {clock.workModel === null ? null : (
          <span className="ms-auto inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted [&_svg]:size-3.5">
            <icons.location aria-hidden />
            {WHERE[clock.workModel]}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <LiveTimer workedMinutes={worked} running={state === 'in'} since={now} />
          <p className="mt-2 text-sm text-fg-muted">{sub}</p>
        </div>
        <div ref={card} className="flex gap-2">
          {state === 'in'
            ? [
                action('break_start', 'Start break', 'break', false),
                action('out', 'Clock out', 'stop', true),
              ]
            : state === 'on_break'
              ? action('break_end', 'End break', 'play', true)
              : action('in', 'Clock in', 'play', true)}
        </div>
      </div>
      <RangeBar
        label="Today"
        domain={DAY}
        ticks={[420, 600, 780, 960, 1140]}
        format={clockTime}
        now={minuteOfDay(now, zone)}
        segments={today.segments.map((s) => ({
          start: s.from,
          end: s.to,
          ...(SEGMENT[s.kind] ?? { label: s.kind }),
        }))}
      />
      {state === 'out' ? (
        <ClockIn
          className="hidden touch:flex"
          workModel={where}
          onWorkModel={setWhere}
          offices={[]}
          disabled={onPunch === undefined || pending}
          onClockIn={(model) => {
            press('in', model, true);
          }}
        />
      ) : state === 'in' ? (
        <ClockOutSheet
          open={closing}
          onOpenChange={setClosing}
          day={today}
          minute={minuteOfDay(now, zone)}
          disabled={onPunch === undefined || pending}
          onClockOut={() => {
            setClosing(false);
            press('out', workModel, true);
          }}
        />
      ) : null}
      {failed === null ? null : (
        <Alert tone="danger" title="The clock did not change">
          {failed}
        </Alert>
      )}
    </Card>
  );
}

/**
 * Time worked today, ticking each second while clocked in: its own state, so
 * a tick redraws these digits and nothing else. It starts from the server's
 * `since`, so the server's HTML and the first browser render agree.
 */
function LiveTimer({
  workedMinutes,
  running,
  since,
}: {
  readonly workedMinutes: number;
  readonly running: boolean;
  readonly since: string;
}): JSX.Element {
  const from = Date.parse(since);
  const [at, setAt] = useState(from);
  useEffect(() => {
    if (!running) return;
    setAt(Date.now());
    const timer = setInterval(() => {
      setAt(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [running]);
  const seconds = workedMinutes * 60 + (running ? Math.max(0, Math.floor((at - from) / 1000)) : 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return (
    <p
      role="timer"
      aria-label={`${String(h)} hours ${String(m)} minutes worked today`}
      className="font-display text-5xl leading-none font-bold tracking-[-0.04em] tabular-nums text-fg"
    >
      {`${String(h)}:${pad(m)}:${pad(s)}`}
    </p>
  );
}

/* ----------------------------------------------------------- balances -- */

function Balances({
  balances,
}: {
  readonly balances: OverviewData['balances'];
}): JSX.Element | null {
  if (balances.length === 0) return null;
  return (
    <Carousel
      label="Your balances"
      controls="none"
      className={'@max-[40rem]/overview:order-2'}
      itemClassName="w-56 @min-[40rem]/overview:w-auto @min-[40rem]/overview:min-w-0 @min-[40rem]/overview:flex-1 @min-[40rem]/overview:shrink"
    >
      {balances.map((b) => {
        const hours = b.unit === 'hour';
        const used = Number(b.used);
        const booked = Number(b.booked);
        return (
          <Stat
            key={b.leaveTypeKey}
            className="h-full"
            label={b.name}
            icon={leaveIcon(b.icon)}
            value={hours ? `${amount(b.left)}h` : amount(b.left)}
            unit={hours ? 'banked' : 'days left'}
            description={
              <Button variant="link" size="xs" asChild>
                <a
                  href={`/time-off/balances/${b.leaveTypeKey}`}
                  aria-label={`${b.name}: where the days went`}
                >
                  Where the days went
                </a>
              </Button>
            }
          >
            {b.yearly === null ? null : (
              <Progress
                label={b.name}
                max={Number(b.yearly)}
                showValue
                valueLabel={`${amount(b.yearly)} a year`}
                segments={[
                  { value: used, label: `${amount(b.used)} used`, tone: chartTone(b.colorToken) },
                  ...(booked > 0
                    ? [
                        {
                          value: booked,
                          label: `${amount(b.booked)} booked`,
                          tone: chartTone(b.colorToken),
                          pattern: 'hatched' as const,
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </Stat>
        );
      })}
    </Carousel>
  );
}

/* ---------------------------------------------------------- coming up -- */

function ComingUp({
  data,
  today,
}: {
  readonly data: OverviewData;
  readonly today: string;
}): JSX.Element {
  const rows = [
    ...data.comingUp.map((r) => ({ at: r.span.from, request: r, holiday: null })),
    ...data.holidays.map((h) => ({ at: h.date, request: null, holiday: h })),
  ]
    .toSorted((a, b) => a.at.localeCompare(b.at))
    .slice(0, 4);
  const year = today.slice(0, 4);
  return (
    <PageSection
      title="Coming up"
      className={'@max-[40rem]/overview:order-4'}
      actions={
        <Button variant="ghost" size="sm" asChild>
          <a href={`/time-off/holidays/${year}`}>All holidays</a>
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing booked, and no holidays ahead this year.</p>
      ) : (
        <List>
          {rows.map(({ request, holiday }, index) => {
            const late = index >= 2 ? '@max-[40rem]/overview:hidden' : undefined;
            if (holiday !== null) {
              const days = daysBetween(today, holiday.date);
              return (
                <ListItem
                  key={`h${holiday.date}`}
                  className={late}
                  icon={<icons.flagged />}
                  iconTone="neutral"
                  description={`${shortDate(holiday.date)} · public holiday`}
                  trailing={
                    <span className="text-sm text-fg-muted">
                      {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${String(days)} days`}
                    </span>
                  }
                >
                  {holiday.name}
                </ListItem>
              );
            }
            const type = data.balances.find((b) => b.leaveTypeKey === request.leaveTypeKey);
            const status = statusOf(request.status);
            const days = amount(request.workingDays);
            return (
              <ListItem
                key={request.requestId}
                asChild
                className={late}
                icon={leaveIcon(type?.icon)}
                iconTone={chartTone(type?.colorToken)}
                description={`${days} ${days === '1' ? 'day' : 'days'}`}
                trailing={
                  <Badge size="sm" tone={status.tone} dot>
                    {status.label}
                  </Badge>
                }
              >
                <a href={`/time-off/requests/${request.requestId}`}>
                  {`${request.leaveTypeName} · ${spanLabel(request.span.from, request.span.to)}`}
                </a>
              </ListItem>
            );
          })}
        </List>
      )}
    </PageSection>
  );
}

/* ------------------------------------------------------------ bridges -- */

function Bridges({
  bridges,
  left,
  type,
}: {
  readonly bridges: OverviewData['bridges'];
  readonly left: string;
  readonly type: OverviewData['balances'][number];
}): JSX.Element {
  return (
    <AssistantCard
      title={`Make the most of your ${left} days`}
      className={'@max-[40rem]/overview:order-3'}
      action={
        bridges.some((b) => b.text.ai) ? (
          <Badge tone="assistant" size="sm">
            AI
          </Badge>
        ) : undefined
      }
      note="Uses your working week and the holidays where you work. Nothing is booked until you send it."
    >
      <List>
        {bridges.map((b, index) => (
          <ListItem
            key={b.from}
            className={index > 0 ? '@max-[40rem]/overview:hidden' : undefined}
            leading={
              <Badge tone="accent" size="lg">
                {`${String(b.used)} → ${String(b.away.days)}`}
                <span className="sr-only"> days off</span>
              </Badge>
            }
            supporting={b.text.text}
            trailing={
              <Button variant="secondary" size="xs" asChild>
                <a
                  href={`/time-off/request?type=${type.leaveTypeKey}&from=${b.from}&to=${b.to}`}
                  aria-label={`Request ${bridgeDays(b)}`}
                >
                  Request
                </a>
              </Button>
            }
          >
            {`Take ${bridgeDays(b)}`}
          </ListItem>
        ))}
      </List>
    </AssistantCard>
  );
}

/* --------------------------------------------------------- team today -- */

function TeamToday({
  data,
  today,
}: {
  readonly data: OverviewData;
  readonly today: string;
}): JSX.Element {
  return (
    <PageSection
      title="Your team today"
      className={'@max-[40rem]/overview:hidden'}
      actions={
        <Button variant="ghost" size="sm" asChild endIcon={<icons.forward aria-hidden />}>
          <a href="/time-off/calendar/month">Calendar</a>
        </Button>
      }
    >
      {data.teamToday.length === 0 ? (
        <p className="text-sm text-fg-muted">Everybody is in today.</p>
      ) : (
        <List>
          {data.teamToday.map((p) => {
            const type = data.balances.find((b) => b.leaveTypeKey === p.leaveTypeKey);
            return (
              <ListItem
                key={p.personId}
                leading={<Avatar name={p.displayName} />}
                description={`Back ${shortDate(nextWorkingDay(p.span.to < today ? today : p.span.to))}`}
                trailing={<Badge size="sm">{type?.name ?? 'Away'}</Badge>}
              >
                {p.displayName}
              </ListItem>
            );
          })}
        </List>
      )}
    </PageSection>
  );
}

/* ----------------------------------------------------------- skeleton -- */

/**
 * The overview while it loads, in its exact shape: the header's two lines,
 * the clock card, the balances row and the lists, in the same columns, so
 * nothing moves when the answer lands.
 */
export function OverviewSkeleton(): JSX.Element {
  const block = (className: string): JSX.Element => <Skeleton className={className} />;
  return (
    <div className="@container/overview flex flex-col gap-6">
      {/* A no-break space holds the description's line until the date is known. */}
      <PageHeader title="Time off" description={' '} />
      <div role="status" className={body}>
        <span className="sr-only">Loading your time off</span>
        <div className={column}>
          {block(`h-60 rounded-lg @max-[40rem]/overview:order-1`)}
          <div className={`flex gap-3 overflow-hidden @max-[40rem]/overview:order-2`}>
            {[0, 1, 2, 3].map((n) => (
              <Skeleton
                key={n}
                className="h-36 w-56 shrink-0 rounded-lg @min-[40rem]/overview:w-auto @min-[40rem]/overview:flex-1"
              />
            ))}
          </div>
          {block(`h-72 rounded-lg @max-[40rem]/overview:order-4`)}
        </div>
        <div className={column}>
          {block(`h-56 rounded-lg @max-[40rem]/overview:order-3`)}
          {block(`h-48 rounded-lg @max-[40rem]/overview:hidden`)}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- words -- */

// The settings screens draw leave types the way the overview does.
export { amount, chartTone, leaveIcon };
const clockTime = (minutes: number): string =>
  `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${String(h)}h` : h === 0 ? `${String(m)}m` : `${String(h)}h ${String(m)}m`;
}

function parts(at: string, zone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
}
const localDate = (at: string, zone: string): string => {
  const p = parts(at, zone);
  return `${p['year'] ?? ''}-${p['month'] ?? ''}-${p['day'] ?? ''}`;
};
const minuteOfDay = (at: string, zone: string): number => {
  const p = parts(at, zone);
  return Number(p['hour']) * 60 + Number(p['minute']);
};
function partOfDay(at: string, zone: string): string {
  const hour = Math.floor(minuteOfDay(at, zone) / 60);
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}
