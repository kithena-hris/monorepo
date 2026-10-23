import {
  Alert,
  Badge,
  Button,
  Input,
  KbdShortcut,
  KeyValues,
  List,
  ListItem,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SegmentedControl,
  SegmentedControlItem,
  Slider,
  icons,
  keysOf,
  useCoarsePointerAt,
  useScreenCommand,
  useShortcutKeys,
  type ChartTone,
  type IconName,
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

import { DayBar } from '../attendance/day-bar';
import {
  PUNCHED,
  SOURCE,
  WHERE,
  clockTime,
  duration,
  localDate,
  minuteOfDay,
  stateAfter,
  stopwatch,
  workedSeconds,
  type ClockState,
  type Day,
  type Punch,
  type PunchKind,
  type WorkModel,
} from '../attendance/time';
import type { Loadable, Outcome } from '../load';
import { checkOnce, insideFor, type Office } from './location';
import { t } from '../i18n';

/**
 * The clock in the top bar (T2, PRD §11.1), on every page of Kithena: a pill
 * with the time worked today that ticks every second, and behind it the day
 * as a bar, the punches so far, what you are working on, Start break and
 * Clock out. ⌥T opens and closes it (`clock` in the shell's shortcuts).
 *
 * There is one clock: what the badge reader, the phone and this pill punch
 * is the same record, and closing the tab does not stop it. Drawn from the
 * shell's read of the last week's punches and when it asked (`now`); a punch
 * goes through the shell (`onPunch`) and comes back as the page drawn again.
 *
 * Under a finger the popover is a sheet (Reach's `Popover`) and clocking in
 * is a slide (MT3); its one location check suggests Office and keeps nothing.
 */

export type PunchSource = 'web' | 'mobile';

export interface ClockData {
  readonly member: { readonly personId: string; readonly timeZone: string };
  readonly days: readonly Day[];
  /** The last week's standing punches, oldest first or not. */
  readonly punches: readonly Punch[];
  /** When the shell asked, ISO: the pill counts on from it. */
  readonly now: string;
  /** Where the company works from, for the phone's one check; none, it never asks. */
  readonly offices?: readonly Office[];
  /** S16: a clock-in counts only from inside one of `offices`. */
  readonly onlyInOfficeArea?: boolean;
}

export interface TopBarClockProps {
  readonly load: Loadable<ClockData>;
  /** Clock in, start or end a break, clock out. Absent, the clock has no buttons. */
  readonly onPunch?: (
    kind: PunchKind,
    workModel: WorkModel,
    source: PunchSource,
    insideOfficeArea?: boolean | null,
  ) => Promise<Outcome>;
}

const STATE: Record<ClockState, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  in: { label: t('clock.clock.clocked_in', 'Clocked in'), tone: 'success' },
  on_break: { label: t('clock.clock.on_a_break', 'On a break'), tone: 'warning' },
  out: { label: t('clock.clock.not_clocked_in', 'Not clocked in'), tone: 'neutral' },
};

const PUNCH_ICON: Record<PunchKind, { icon: IconName; tone: ChartTone }> = {
  in: { icon: 'play', tone: 'success' },
  out: { icon: 'stop', tone: 'neutral' },
  break_start: { icon: 'break', tone: 'warning' },
  break_end: { icon: 'play', tone: 'success' },
};

const icon = (name: IconName): ReactNode => createElement(icons[name], { 'aria-hidden': true });

/** Nothing until the shell has the clock; nothing for somebody who has none. */
export function TopBarClock({ load, onPunch }: TopBarClockProps): JSX.Element | null {
  if (load.status !== 'ready') return null;
  return <Clock data={load.data} onPunch={onPunch} />;
}

function Clock({
  data,
  onPunch,
}: {
  readonly data: ClockData;
  readonly onPunch: TopBarClockProps['onPunch'];
}): JSX.Element {
  const zone = data.member.timeZone;
  const today = localDate(data.now, zone);
  const mine = data.punches
    .filter((p) => localDate(p.at, zone) === today)
    .toSorted((a, b) => a.at.localeCompare(b.at));
  const state = stateAfter(data.punches);
  const last = data.punches.toSorted((a, b) => a.at.localeCompare(b.at)).at(-1);
  const day = data.days.find((d) => d.date === today);
  const [open, setOpen] = useState(false);
  useScreenCommand({
    id: 'clock',
    label: open
      ? t('clock.clock.close_the_clock', 'Close the clock')
      : t('clock.clock.open_the_clock', 'Open the clock'),
    run: () => {
      setOpen((was) => !was);
    },
  });
  const panel = useRef<HTMLDivElement>(null);
  const coarse = useCoarsePointerAt(panel);
  const [workModel, setWorkModel] = useState<WorkModel>(last?.workModel ?? 'office');
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const press = (kind: PunchKind, where: WorkModel = workModel): void => {
    if (onPunch === undefined) return;
    setFailed(null);
    start(async () => {
      const outcome = await onPunch(
        kind,
        where,
        coarse ? 'mobile' : 'web',
        await insideFor(kind, data),
      );
      if (!outcome.ok) setFailed(outcome.message);
    });
  };
  const keys = keysOf('clock', useShortcutKeys());
  const since = Date.parse(data.now);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {state === 'out' ? (
          <Button size="sm" startIcon={icon('play')} shortcut="clock">
            {t('clock.clock.clock_in', 'Clock in')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            shortcut="clock"
            aria-label={t('clock.clock.the_clock', 'The clock: {{label}}', {
              label: STATE[state].label.toLowerCase(),
            })}
          >
            <Badge tone={STATE[state].tone} pulse>
              <Ticking
                punches={mine}
                since={since}
                show={state === 'on_break' ? 'break' : 'worked'}
              />
            </Badge>
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t('clock.clock.the_clock_2', 'The clock')}
        className="flex w-100 flex-col gap-4"
      >
        <div ref={panel} className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <Badge tone={STATE[state].tone} pulse={state !== 'out'} dot={state === 'out'}>
              {state === 'out' || last === undefined
                ? STATE[state].label
                : t('clock.clock.text', '{{label}} · {{WHERE}}', {
                    label: STATE[state].label,
                    WHERE: WHERE[last.workModel],
                  })}
            </Badge>
            {keys.length === 0 ? null : (
              <KbdShortcut keys={keys} className="ms-auto touch:hidden" />
            )}
          </div>
          <p
            role="timer"
            className="font-display text-5xl leading-none font-bold tracking-[-0.04em] tabular-nums"
          >
            <Ticking punches={mine} since={since} show="worked" />
          </p>
          {day === undefined ? null : (
            <DayBar
              label={t('clock.clock.today', 'Today')}
              segments={day.segments}
              now={minuteOfDay(data.now, zone)}
            />
          )}
          {mine.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {day !== undefined && day.plannedMinutes > 0
                ? t(
                    'clock.clock.your_day_is_nothing_punched_yet',
                    'Your day is {{plannedMinutes}}. Nothing punched yet today.',
                    { plannedMinutes: duration(day.plannedMinutes) },
                  )
                : t('clock.clock.nothing_punched_today', 'Nothing punched today.')}
            </p>
          ) : (
            <List aria-label={t('clock.clock.todays_punches', 'Today’s punches')}>
              {mine.map((p) => (
                <ListItem
                  key={p.id}
                  icon={icon(PUNCH_ICON[p.kind].icon)}
                  iconTone={PUNCH_ICON[p.kind].tone}
                  description={t('clock.clock.text_2', '{{value}} · {{WHERE}}', {
                    value: SOURCE[p.source] ?? p.source,
                    WHERE: WHERE[p.workModel],
                  })}
                >
                  {t('clock.clock.text_3', '{{clockTime}} {{PUNCHED}}', {
                    clockTime: clockTime(minuteOfDay(p.at, zone)),
                    PUNCHED: PUNCHED[p.kind],
                  })}
                </ListItem>
              ))}
            </List>
          )}
          {state === 'out' ? (
            <ClockIn
              workModel={workModel}
              onWorkModel={setWorkModel}
              offices={data.offices ?? []}
              disabled={onPunch === undefined || pending}
              onClockIn={(where) => {
                press('in', where);
              }}
              desk={
                <Button
                  variant="primary"
                  className="w-full touch:hidden"
                  startIcon={icon('play')}
                  disabled={onPunch === undefined || pending}
                  onClick={() => {
                    press('in');
                  }}
                >
                  {t('clock.clock.clock_in', 'Clock in')}
                </Button>
              }
            />
          ) : (
            <>
              <WorkingOn />
              {day === undefined ? null : (
                // Under a finger, the day in numbers before clocking out (MT4).
                <DayNumbers day={day} className="hidden touch:grid" />
              )}
              <div className="flex gap-2">
                {state === 'in' ? (
                  <Button
                    className="flex-1"
                    startIcon={icon('break')}
                    disabled={onPunch === undefined || pending}
                    onClick={() => {
                      press('break_start');
                    }}
                  >
                    {t('clock.clock.start_break', 'Start break')}
                  </Button>
                ) : (
                  <Button
                    className="flex-1"
                    startIcon={icon('play')}
                    disabled={onPunch === undefined || pending}
                    onClick={() => {
                      press('break_end');
                    }}
                  >
                    {t('clock.clock.end_break', 'End break')}
                  </Button>
                )}
                <Button
                  variant="primary"
                  className="flex-1"
                  startIcon={icon('stop')}
                  disabled={onPunch === undefined || pending}
                  onClick={() => {
                    press('out');
                  }}
                >
                  {t('clock.clock.clock_out', 'Clock out')}
                </Button>
              </div>
              <PopoverClose asChild>
                <Button variant="ghost" className="hidden w-full touch:inline-flex">
                  {t('clock.clock.keep_working', 'Keep working')}
                </Button>
              </PopoverClose>
            </>
          )}
          {failed === null ? null : (
            <Alert
              tone="danger"
              title={t('clock.clock.the_clock_did_not_change', 'The clock did not change')}
            >
              {failed}
            </Alert>
          )}
          <p className="text-xs text-fg-muted">
            {t(
              'clock.clock.one_clock_across_the_badge_reader',
              'One clock across the badge reader, the web and the app. Closing the tab doesn’t stop it.',
            )}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Time worked today, or on this break, ticking each second while it runs: its
 * own state, so a tick redraws these digits and nothing else on the page. It
 * starts from the shell's `since`, so the server's HTML and the first render
 * in the browser agree.
 */
function Ticking({
  punches,
  since,
  show,
}: {
  readonly punches: readonly Punch[];
  readonly since: number;
  readonly show: 'worked' | 'break';
}): string {
  const [at, setAt] = useState(since);
  const state = stateAfter(punches);
  useEffect(() => {
    if (state === 'out') return;
    setAt(Date.now());
    const timer = setInterval(() => {
      setAt(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [state]);
  const { worked, breakSince } = workedSeconds(punches, at);
  return show === 'break' && breakSince !== null
    ? t('clock.clock.break', 'Break · {{replace}}', {
        replace: stopwatch((at - breakSince) / 1000).replace(/^0:/, ''),
      })
    : stopwatch(worked);
}

/** What you are working on, in your own words, until Projects can say (PRD §5.4). Kept on this device. */
function WorkingOn(): JSX.Element {
  const KEY = 'kithena.timeoff.working-on';
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    try {
      setText(localStorage.getItem(KEY) ?? '');
    } catch {
      // No storage here: the label starts empty.
    }
  }, []);
  const save = (next: string): void => {
    setText(next);
    setEditing(false);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Kept for this page only.
    }
  };
  if (editing) {
    return (
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get('working-on');
          save(typeof value === 'string' ? value.trim() : '');
        }}
      >
        <Input
          name="working-on"
          aria-label={t('clock.clock.what_you_are_working_on', 'What you are working on')}
          defaultValue={text}
          maxLength={80}
          placeholder={t(
            'clock.clock.for_example_the_billing_release',
            'For example, the billing release',
          )}
          className="flex-1"
        />
        <Button type="submit" size="sm">
          {t('clock.clock.save', 'Save')}
        </Button>
      </form>
    );
  }
  return (
    <List>
      <ListItem
        icon={icon('edit')}
        iconTone="neutral"
        description={t(
          'clock.clock.your_own_words_on_this_device',
          'Your own words, on this device',
        )}
        trailing={
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setEditing(true);
            }}
          >
            {text === '' ? t('clock.clock.add', 'Add') : t('clock.clock.change', 'Change')}
          </Button>
        }
      >
        {text === ''
          ? t('clock.clock.what_are_you_working_on', 'What are you working on?')
          : t('clock.clock.working_on', 'Working on {{text}}', { text })}
      </ListItem>
    </List>
  );
}

/** What a day's numbers are drawn from: the overview's day carries no overtime. */
type DaySoFar = Pick<Day, 'segments' | 'workedMinutes' | 'breakMinutes'> & {
  readonly overtimeMinutes?: number;
};

/** The day so far in three numbers: worked, break, overtime. */
function DayNumbers({
  day,
  className,
}: {
  readonly day: DaySoFar;
  readonly className?: string;
}): JSX.Element {
  return (
    <KeyValues
      columns={3}
      className={className}
      items={[
        { label: t('clock.clock.worked', 'Worked'), value: duration(day.workedMinutes ?? 0) },
        { label: t('clock.clock.break_2', 'Break'), value: duration(day.breakMinutes) },
        { label: t('clock.clock.overtime', 'Overtime'), value: duration(day.overtimeMinutes ?? 0) },
      ]}
    />
  );
}

/**
 * Clocking in (MT3): where today is worked, and under a finger a deliberate
 * slide, so it cannot happen by a stray tap. Under a finger it checks the
 * device's location once, if the company has offices to compare with, and
 * says so; the answer is the work model it suggests, and the coordinates
 * are dropped where they were read. `desk` is what clocks in with a mouse.
 */
export function ClockIn({
  workModel,
  onWorkModel,
  offices,
  disabled,
  onClockIn,
  desk,
  className,
}: {
  readonly workModel: WorkModel;
  readonly onWorkModel: (next: WorkModel) => void;
  readonly offices: readonly Office[];
  readonly disabled: boolean;
  readonly onClockIn: (workModel: WorkModel) => void;
  readonly desk?: ReactNode;
  readonly className?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const coarse = useCoarsePointerAt(ref);
  const [found, setFound] = useState<Office | null>(null);
  const suggest = useRef(onWorkModel);
  suggest.current = onWorkModel;
  useEffect(() => {
    if (!coarse || offices.length === 0) return;
    let live = true;
    void checkOnce(offices).then((office) => {
      if (!live || office === null) return;
      setFound(office);
      suggest.current('office');
    });
    return () => {
      live = false;
    };
  }, [coarse, offices]);
  return (
    <div ref={ref} className={`flex flex-col gap-3 ${className ?? ''}`}>
      <SegmentedControl
        fullWidth
        aria-label={t('clock.clock.where_you_are_working_today', 'Where you are working today')}
        value={workModel}
        onValueChange={(next) => {
          onWorkModel(next as WorkModel);
        }}
      >
        <SegmentedControlItem value="office">
          {icon('company')}
          {t('clock.clock.office', 'Office')}
        </SegmentedControlItem>
        <SegmentedControlItem value="remote">
          {icon('home')}
          {t('clock.clock.remote', 'Remote')}
        </SegmentedControlItem>
        <SegmentedControlItem value="client">
          {icon('organisation')}
          {t('clock.clock.client', 'Client')}
        </SegmentedControlItem>
      </SegmentedControl>
      {found === null ? null : (
        <p className="flex items-center gap-2 text-sm">
          <span className="text-success-fg [&_svg]:size-4">{icon('location')}</span>
          <span className="flex-1">
            {t('clock.clock.youre_at', 'You’re at')} <strong>{found.name}</strong>
          </span>
          <Badge size="sm">{t('clock.clock.checked_once', 'Checked once')}</Badge>
        </p>
      )}
      {desk}
      <Slider
        variant="confirm"
        label={t('clock.clock.slide_to_clock_in', 'Slide to clock in')}
        className="hidden touch:block"
        disabled={disabled}
        onConfirm={() => {
          onClockIn(workModel);
        }}
      />
      <p className="hidden text-xs text-fg-muted touch:block">
        {t(
          'clock.clock.location_is_checked_only_at_the',
          'Location is checked only at the moment you clock in, to fill in “Office”. Kithena never tracks where you go.',
        )}
      </p>
    </div>
  );
}

/**
 * Clocking out under a finger (MT4): the day before it is confirmed, as a
 * bar and in numbers, then Clock out or Keep working.
 */
export function ClockOutSheet({
  open,
  onOpenChange,
  day,
  minute,
  disabled,
  onClockOut,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly day: DaySoFar;
  /** The minute it is now, in the person's zone. */
  readonly minute: number;
  readonly disabled: boolean;
  readonly onClockOut: () => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheetOnTouch>
        <DialogHeader>
          <DialogTitle>
            {t('clock.clock.clock_out_at', 'Clock out at {{clockTime}}?', {
              clockTime: clockTime(minute),
            })}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <DayBar label={t('clock.clock.today', 'Today')} segments={day.segments} now={minute} />
          <DayNumbers day={day} />
        </DialogBody>
        <DialogFooter className="flex flex-col gap-2">
          <Button
            variant="primary"
            className="w-full"
            startIcon={icon('stop')}
            disabled={disabled}
            onClick={onClockOut}
          >
            {t('clock.clock.clock_out', 'Clock out')}
          </Button>
          <DialogClose asChild>
            <Button variant="ghost" className="w-full">
              {t('clock.clock.keep_working', 'Keep working')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
